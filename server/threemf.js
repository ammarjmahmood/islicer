// Reads and writes 3MF files (a zip of XML) without any extra packages.
//
// writeProject() makes a Bambu Studio project with one object per model, so the
// printer sees separate objects (you can skip one that fails), and each object can
// carry its own filament slot, its own settings and painted supports / seams.
// readModels() pulls the meshes out of any 3MF so the app can lay them out again.
const fs = require('fs');
const zlib = require('zlib');

// ---- zip ------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** entries: [{ name, data: Buffer|string }] -> Buffer */
function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const raw = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, 'utf8');
    const packed = zlib.deflateRawSync(raw, { level: 6 });
    const crc = crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, packed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + packed.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

/** Buffer -> Map(name -> Buffer). Handles stored and deflated entries. */
function unzip(buffer) {
  let end = buffer.length - 22;
  while (end >= 0 && buffer.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error('This file is not a valid 3MF (zip) file.');
  const count = buffer.readUInt16LE(end + 10);
  let pointer = buffer.readUInt32LE(end + 16);
  const files = new Map();
  for (let i = 0; i < count; i++) {
    if (buffer.readUInt32LE(pointer) !== 0x02014b50) break;
    const method = buffer.readUInt16LE(pointer + 10);
    const packedSize = buffer.readUInt32LE(pointer + 20);
    const nameLength = buffer.readUInt16LE(pointer + 28);
    const extraLength = buffer.readUInt16LE(pointer + 30);
    const commentLength = buffer.readUInt16LE(pointer + 32);
    const localOffset = buffer.readUInt32LE(pointer + 42);
    const name = buffer.toString('utf8', pointer + 46, pointer + 46 + nameLength);
    const localName = buffer.readUInt16LE(localOffset + 26);
    const localExtra = buffer.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localName + localExtra;
    const packed = buffer.subarray(start, start + packedSize);
    if (method === 0) files.set(name, packed);
    else if (method === 8) files.set(name, zlib.inflateRawSync(packed));
    pointer += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

// ---- writing a plain 3MF ------------------------------------------------------

const num = (value) => {
  const rounded = Math.round(value * 1e5) / 1e5;
  return Object.is(rounded, -0) ? '0' : String(rounded);
};

/** Shares identical corners so the slicer sees one closed surface, not loose triangles. */
function indexMesh(vertices) {
  const lookup = new Map();
  const points = [];
  const triangles = new Uint32Array(vertices.length / 3);
  for (let i = 0; i < vertices.length; i += 3) {
    const key = `${num(vertices[i])},${num(vertices[i + 1])},${num(vertices[i + 2])}`;
    let index = lookup.get(key);
    if (index === undefined) {
      index = points.length / 3;
      lookup.set(key, index);
      points.push(vertices[i], vertices[i + 1], vertices[i + 2]);
    }
    triangles[i / 3] = index;
  }
  return { points, triangles };
}

// How Bambu Studio stores a painted triangle that is not subdivided:
// the state sits above the two "split" bits, so state 1 -> "4", 2 -> "8".
// States 3 and up use the extended form: nibble 0b1100, then (state - 3).
function paintCode(state) {
  if (!state) return '';
  if (state < 3) return (state << 2).toString(16).toUpperCase();
  return `${(state - 3).toString(16).toUpperCase()}C`;
}

/**
 * Writes a plain 3MF with one object per entry, in place on the bed. Bambu Studio
 * turns it into its own project (see bambu-slicer.js), keeping the painted triangles.
 * objects: [{ vertices (Float64Array, printer mm, already placed), paint: { supports, seam, color } }]
 * paint.* are arrays with one state per triangle: supports 1 = add, 2 = block;
 * seam 1 = put the seam here, 2 = keep it away; color = filament slot (1-based).
 */
function writeProject(objects, outPath) {
  const modelParts = [];
  const buildItems = [];
  objects.forEach((object, index) => {
    const id = index + 1;
    const { points, triangles } = indexMesh(object.vertices);
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < points.length; i += 3) {
      for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a], points[i + a]); max[a] = Math.max(max[a], points[i + a]); }
    }
    // Store the mesh about its own centre and place it with the build transform.
    const centre = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, min[2]];
    const vertexXml = [];
    for (let i = 0; i < points.length; i += 3) {
      vertexXml.push(`<vertex x="${num(points[i] - centre[0])}" y="${num(points[i + 1] - centre[1])}" z="${num(points[i + 2] - centre[2])}"/>`);
    }
    const paint = object.paint || {};
    const triangleXml = [];
    for (let t = 0; t < triangles.length / 3; t++) {
      let attrs = `v1="${triangles[t * 3]}" v2="${triangles[t * 3 + 1]}" v3="${triangles[t * 3 + 2]}"`;
      if (paint.supports && paint.supports[t]) attrs += ` paint_supports="${paintCode(paint.supports[t])}"`;
      if (paint.seam && paint.seam[t]) attrs += ` paint_seam="${paintCode(paint.seam[t])}"`;
      if (paint.color && paint.color[t]) attrs += ` paint_color="${paintCode(paint.color[t])}"`;
      triangleXml.push(`<triangle ${attrs}/>`);
    }
    modelParts.push(`  <object id="${id}" type="model"><mesh><vertices>${vertexXml.join('')}</vertices><triangles>${triangleXml.join('')}</triangles></mesh></object>`);
    buildItems.push(`  <item objectid="${id}" transform="1 0 0 0 1 0 0 0 1 ${num(centre[0])} ${num(centre[1])} ${num(centre[2])}"/>`);
  });

  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <metadata name="Application">iSlicer</metadata>
  <resources>
${modelParts.join('\n')}
  </resources>
  <build>
${buildItems.join('\n')}
  </build>
</model>
`;
  const types = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
 <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
 <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>
`;
  const rels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>
`;
  fs.writeFileSync(outPath, zip([
    { name: '[Content_Types].xml', data: types },
    { name: '_rels/.rels', data: rels },
    { name: '3D/3dmodel.model', data: model },
  ]));
}

// ---- reading any 3MF ----------------------------------------------------------

const attr = (tag, name) => {
  const match = new RegExp(`\\b${name}="([^"]*)"`).exec(tag);
  return match ? match[1] : null;
};

function parseMatrix(text) {
  if (!text) return [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
  const v = text.trim().split(/\s+/).map(Number);
  return v.length === 12 ? v : [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
}

// 3MF matrices are row vectors: p' = p * M, stored m00 m01 m02 m10 ... m30 m31 m32.
function multiply(a, b) {
  const out = new Array(12);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 3; c++) {
      out[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c] + (r === 3 ? b[9 + c] : 0);
    }
  }
  return out;
}

/**
 * Returns [{ name, vertices: Float64Array }] — one per object placed on the build
 * plate, with the 3MF's own rotation and scale applied (positions are re-laid out by the app).
 */
function readModels(filePath) {
  const files = unzip(fs.readFileSync(filePath));
  const modelFiles = new Map();
  for (const [name, data] of files) if (/\.model$/i.test(name)) modelFiles.set(`/${name.replace(/^\//, '')}`, data.toString('utf8'));
  const rootName = [...modelFiles.keys()].find((name) => /^\/3D\/3dmodel\.model$/i.test(name)) || [...modelFiles.keys()][0];
  if (!rootName) throw new Error('This 3MF has no 3D model inside.');

  const objectsByFile = new Map();
  const objectsIn = (file) => {
    if (objectsByFile.has(file)) return objectsByFile.get(file);
    const xml = modelFiles.get(file) || '';
    const objects = new Map();
    const pattern = /<object\b([^>]*)>([\s\S]*?)<\/object>/g;
    let match;
    while ((match = pattern.exec(xml))) objects.set(attr(match[1], 'id'), { head: match[1], body: match[2] });
    objectsByFile.set(file, objects);
    return objects;
  };

  const collect = (file, id, matrix, out, depth = 0) => {
    const object = objectsIn(file).get(id);
    if (!object || depth > 8) return;
    const mesh = /<mesh>([\s\S]*?)<\/mesh>/.exec(object.body);
    if (mesh) {
      const points = [];
      const vp = /<vertex\b([^>]*)\/>/g;
      let v;
      while ((v = vp.exec(mesh[1]))) points.push(+attr(v[1], 'x'), +attr(v[1], 'y'), +attr(v[1], 'z'));
      const tp = /<triangle\b([^>]*)\/>/g;
      let t;
      while ((t = tp.exec(mesh[1]))) {
        for (const key of ['v1', 'v2', 'v3']) {
          const i = +attr(t[1], key) * 3;
          const x = points[i], y = points[i + 1], z = points[i + 2];
          out.push(
            x * matrix[0] + y * matrix[3] + z * matrix[6] + matrix[9],
            x * matrix[1] + y * matrix[4] + z * matrix[7] + matrix[10],
            x * matrix[2] + y * matrix[5] + z * matrix[8] + matrix[11],
          );
        }
      }
    }
    const cp = /<component\b([^>]*)\/>/g;
    let c;
    while ((c = cp.exec(object.body))) {
      const target = attr(c[1], 'p:path') || file;
      collect(target, attr(c[1], 'objectid'), multiply(parseMatrix(attr(c[1], 'transform')), matrix), out, depth + 1);
    }
  };

  const root = modelFiles.get(rootName);
  const names = new Map();
  for (const [, object] of objectsIn(rootName)) {
    const name = /<metadata\s+name="name"[^>]*>([^<]*)</i.exec(object.body);
    if (name) names.set(attr(object.head, 'id'), name[1]);
  }
  const config = files.get('Metadata/model_settings.config');
  if (config) {
    const op = /<object id="(\d+)">\s*<metadata key="name" value="([^"]*)"/g;
    let o;
    while ((o = op.exec(config.toString('utf8')))) names.set(o[1], o[2]);
  }

  const results = [];
  const ip = /<item\b([^>]*)\/>/g;
  let item;
  while ((item = ip.exec(root))) {
    if (attr(item[1], 'printable') === '0') continue;
    const id = attr(item[1], 'objectid');
    const out = [];
    collect(rootName, id, parseMatrix(attr(item[1], 'transform')), out);
    if (out.length) results.push({ name: names.get(id) || `Model ${results.length + 1}`, vertices: Float64Array.from(out) });
  }
  if (results.length === 0) throw new Error('This 3MF has no printable objects.');
  return results;
}

module.exports = { zip, unzip, writeProject, readModels, paintCode };
