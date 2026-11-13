// Builds one printable plate from several STL files, each with its own
// rotation, scale and position, exactly as laid out in the app.
//
// Coordinates are printer coordinates: millimetres, Z up, origin at the front-left
// corner of the bed. For each item: scale and rotate about the model's own centre,
// drop it onto the bed, then move its footprint centre to (x, y).
const fs = require('fs');

/** Returns a Float64Array of triangle vertices: 9 numbers per triangle. */
function readSTL(filePath) {
  const data = fs.readFileSync(filePath);
  const count = data.length >= 84 ? data.readUInt32LE(80) : 0;
  const looksBinary = data.length === 84 + count * 50;
  if (looksBinary) {
    const out = new Float64Array(count * 9);
    for (let i = 0; i < count; i++) {
      const base = 84 + i * 50 + 12; // skip the stored normal
      for (let k = 0; k < 9; k++) out[i * 9 + k] = data.readFloatLE(base + k * 4);
    }
    return out;
  }
  const text = data.toString('utf8');
  const numbers = [];
  const pattern = /vertex\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)/g;
  let match;
  while ((match = pattern.exec(text))) numbers.push(+match[1], +match[2], +match[3]);
  if (numbers.length === 0 || numbers.length % 9 !== 0) throw new Error('Could not read STL file.');
  return Float64Array.from(numbers);
}

function bounds(vertices) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < vertices.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      const value = vertices[i + a];
      if (value < min[a]) min[a] = value;
      if (value > max[a]) max[a] = value;
    }
  }
  return { min, max };
}

/** Applies one item's transform. `matrix` is a row-major 3x3 rotation. */
function place(vertices, { matrix = [1, 0, 0, 0, 1, 0, 0, 0, 1], scale = 1, x = 0, y = 0 }) {
  const m = matrix.map(Number);
  const s = Number(scale) || 1;
  const first = bounds(vertices);
  const centre = [0, 1, 2].map((a) => (first.min[a] + first.max[a]) / 2);
  const out = new Float64Array(vertices.length);
  for (let i = 0; i < vertices.length; i += 3) {
    const px = (vertices[i] - centre[0]) * s;
    const py = (vertices[i + 1] - centre[1]) * s;
    const pz = (vertices[i + 2] - centre[2]) * s;
    out[i] = m[0] * px + m[1] * py + m[2] * pz;
    out[i + 1] = m[3] * px + m[4] * py + m[5] * pz;
    out[i + 2] = m[6] * px + m[7] * py + m[8] * pz;
  }
  const turned = bounds(out);
  const shift = [
    Number(x) - (turned.min[0] + turned.max[0]) / 2,
    Number(y) - (turned.min[1] + turned.max[1]) / 2,
    -turned.min[2],
  ];
  for (let i = 0; i < out.length; i += 3) {
    out[i] += shift[0];
    out[i + 1] += shift[1];
    out[i + 2] += shift[2];
  }
  return out;
}

function writeBinarySTL(filePath, parts) {
  const total = parts.reduce((sum, part) => sum + part.length / 9, 0);
  const buffer = Buffer.alloc(84 + total * 50);
  buffer.write('iSlicer plate', 0, 'ascii');
  buffer.writeUInt32LE(total, 80);
  let offset = 84;
  for (const v of parts) {
    for (let i = 0; i < v.length; i += 9) {
      const ux = v[i + 3] - v[i], uy = v[i + 4] - v[i + 1], uz = v[i + 5] - v[i + 2];
      const wx = v[i + 6] - v[i], wy = v[i + 7] - v[i + 1], wz = v[i + 8] - v[i + 2];
      let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
      const length = Math.hypot(nx, ny, nz) || 1;
      nx /= length; ny /= length; nz /= length;
      buffer.writeFloatLE(nx, offset); buffer.writeFloatLE(ny, offset + 4); buffer.writeFloatLE(nz, offset + 8);
      for (let k = 0; k < 9; k++) buffer.writeFloatLE(v[i + k], offset + 12 + k * 4);
      offset += 50;
    }
  }
  fs.writeFileSync(filePath, buffer);
}

/**
 * items: [{ path, matrix, scale, x, y }]. Writes the merged plate to outPath and
 * returns its overall size, so the caller can check it fits the printer.
 */
function buildPlate(items, outPath) {
  if (!Array.isArray(items) || items.length === 0) throw new Error('The plate is empty.');
  const parts = items.map((item) => place(readSTL(item.path), item));
  writeBinarySTL(outPath, parts);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const part of parts) {
    const b = bounds(part);
    for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a], b.min[a]); max[a] = Math.max(max[a], b.max[a]); }
  }
  return { min, max, triangles: parts.reduce((sum, part) => sum + part.length / 9, 0) };
}

module.exports = { buildPlate, readSTL, bounds, place };
