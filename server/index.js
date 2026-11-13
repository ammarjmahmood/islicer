const express = require('express');
const multer = require('multer');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const ftp = require('basic-ftp');
const mqtt = require('mqtt');
const QRCode = require('qrcode');
const bambuSlicer = require('./bambu-slicer');
const remote = require('./remote');

const app = express();
const PORT = Number(process.env.PORT || 8005);
const VERSION = '3.0.0';

app.use(cors());
app.use(express.json({ limit: '2mb' }));

const ROOT_DIR = __dirname;
const UPLOAD_DIR = path.join(ROOT_DIR, 'uploads');
const GCODE_DIR = path.join(ROOT_DIR, 'gcode');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
const JOBS_PATH = path.join(DATA_DIR, 'jobs.json');

for (const dir of [UPLOAD_DIR, GCODE_DIR, DATA_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}


const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: Number(process.env.MAX_MODEL_MB || 250) * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (ext === '.stl' || ext === '.3mf') return cb(null, true);
    cb(new Error('Only STL and 3MF files are supported.'));
  },
});

const jobs = loadJobs();

function loadJobs() {
  try {
    const items = JSON.parse(fs.readFileSync(JOBS_PATH, 'utf8'));
    return new Map(items.map((job) => [job.id, job]));
  } catch {
    return new Map();
  }
}

function writeJobs() {
  fs.writeFileSync(JOBS_PATH, JSON.stringify([...jobs.values()], null, 2));
}

function setJob(jobId, job) {
  jobs.set(jobId, job);
  writeJobs();
}

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return { printers: [] };
  }
}

function writeConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  try {
    fs.chmodSync(CONFIG_PATH, 0o600);
  } catch {}
}

function publicPrinter(printer, options = {}) {
  const { accessCode, ...safe } = printer;

  if (options.includeLan) {
    return {
      ...safe,
      hasAccessCode: Boolean(accessCode),
    };
  }

  const { ip, ftpPort, mqttPort, ...phoneSafe } = safe;
  return {
    ...phoneSafe,
    hasAccessCode: Boolean(accessCode),
  };
}

function sanitizeModelName(name, fallback = 'model.stl') {
  const base = path.basename(name || fallback).replace(/[^a-zA-Z0-9._-]/g, '_');
  return base || fallback;
}

function sanitizePrinterFileName(name) {
  const parsed = path.parse(sanitizeModelName(name, 'print.gcode'));
  return `${parsed.name.slice(0, 48)}_${Date.now()}.gcode`.replace(/_+/g, '_');
}

function requirePrinterFields(body) {
  const name = String(body.name || '').trim();
  const ip = String(body.ip || '').trim();
  const serialNumber = String(body.serialNumber || '').trim();
  const accessCode = String(body.accessCode || '').trim();
  const model = String(body.model || 'P1S').trim();

  if (!name) throw new Error('Printer name is required.');
  if (!ip) throw new Error('Printer IP is required.');
  if (!serialNumber) throw new Error('Printer serial number is required.');
  if (!accessCode) throw new Error('LAN access code is required.');

  return { name, ip, serialNumber, accessCode, model };
}

function getPrinter(id) {
  const config = readConfig();
  const printer = config.printers.find((p) => p.id === id);
  if (!printer) {
    const err = new Error('Printer not found.');
    err.status = 404;
    throw err;
  }
  return printer;
}

function getLocalAddresses() {
  const addresses = [];
  for (const interfaces of Object.values(os.networkInterfaces())) {
    for (const item of interfaces || []) {
      if (item.family === 'IPv4' && !item.internal) {
        addresses.push(item.address);
      }
    }
  }
  return addresses;
}

function setupPageHtml() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>iSlicer Bridge Setup</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #08110f;
        --panel: #111a18;
        --panel-2: #192421;
        --line: #2f413c;
        --text: #f6f3eb;
        --muted: #a8b4af;
        --green: #20d19f;
        --red: #ff6b5f;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: var(--bg);
        color: var(--text);
      }
      main {
        width: min(1040px, calc(100vw - 32px));
        margin: 0 auto;
        padding: 48px 0;
      }
      header {
        display: grid;
        gap: 10px;
        margin-bottom: 28px;
      }
      h1, h2, p { margin-top: 0; letter-spacing: 0; }
      h1 { font-size: clamp(34px, 6vw, 68px); line-height: 0.95; margin-bottom: 6px; }
      h2 { font-size: 22px; margin-bottom: 14px; }
      p, label, li { color: var(--muted); line-height: 1.55; }
      .grid {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(320px, 420px);
        gap: 18px;
        align-items: start;
      }
      section, form {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 8px;
        padding: 22px;
      }
      .status {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 10px;
        margin-bottom: 18px;
      }
      .stat {
        background: var(--panel-2);
        border: 1px solid var(--line);
        border-radius: 8px;
        padding: 14px;
      }
      .stat span {
        display: block;
        color: var(--muted);
        font-size: 13px;
        margin-bottom: 6px;
      }
      .stat strong { font-size: 15px; }
      .printer-list {
        display: grid;
        gap: 10px;
      }
      .printer-row {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        align-items: center;
        background: var(--panel-2);
        border: 1px solid var(--line);
        border-radius: 8px;
        padding: 14px;
      }
      .printer-row small {
        display: block;
        color: var(--muted);
        margin-top: 4px;
      }
      .row-actions {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        justify-content: flex-end;
      }
      label {
        display: grid;
        gap: 6px;
        margin-bottom: 12px;
        font-size: 13px;
        font-weight: 800;
      }
      input, select {
        width: 100%;
        border: 1px solid var(--line);
        background: #07100e;
        color: var(--text);
        border-radius: 8px;
        min-height: 44px;
        padding: 0 12px;
        font: inherit;
      }
      button {
        min-height: 42px;
        border: 1px solid transparent;
        border-radius: 8px;
        padding: 0 14px;
        font-weight: 900;
        cursor: pointer;
      }
      .primary { width: 100%; background: var(--green); color: #06110e; }
      .secondary { background: transparent; color: var(--text); border-color: var(--line); }
      .danger { background: transparent; color: var(--red); border-color: rgba(255, 107, 95, 0.45); }
      .note {
        border-left: 3px solid var(--green);
        padding-left: 14px;
        margin-bottom: 18px;
      }
      .message {
        min-height: 22px;
        margin-top: 12px;
        color: var(--muted);
      }
      @media (max-width: 820px) {
        .grid, .status { grid-template-columns: 1fr; }
      }
    </style>
  </head>
  <body>
    <main>
      <header>
        <h1>iSlicer Bridge Setup</h1>
        <p><a href="/pair" style="color:inherit">Pair your phone: show the QR code &rarr;</a></p>
        <p>This is the desktop-side setup. Only the bridge needs printer LAN details. The iPhone only needs the bridge URL.</p>
      </header>

      <div class="status" id="status">
        <div class="stat"><span>Bridge</span><strong>Checking...</strong></div>
        <div class="stat"><span>Slicer</span><strong>Checking...</strong></div>
        <div class="stat"><span>Printers</span><strong>Checking...</strong></div>
      </div>

      <div class="grid">
        <section>
          <h2>Configured printers</h2>
          <p class="note">For easiest remote printing, run this bridge on a computer that stays at home with the printer. A laptop at work can only print home if it has a VPN or Tailscale subnet route back to the printer LAN.</p>
          <div class="printer-list" id="printer-list"></div>
        </section>

        <form id="printer-form">
          <h2>Add Bambu printer</h2>
          <label>
            Printer name
            <input name="name" placeholder="Workshop P1S" required />
          </label>
          <label>
            Model
            <select name="model">
              <option value="P1S">P1S</option>
              <option value="P1P">P1P</option>
              <option value="X1C">X1C</option>
              <option value="X1">X1</option>
              <option value="A1">A1</option>
              <option value="A1Mini">A1 mini</option>
            </select>
          </label>
          <label>
            Printer LAN IP
            <input name="ip" placeholder="192.168.1.100" inputmode="decimal" required />
          </label>
          <label>
            Serial number
            <input name="serialNumber" placeholder="Bambu serial number" required />
          </label>
          <label>
            LAN access code
            <input name="accessCode" placeholder="From printer network settings" type="password" required />
          </label>
          <button class="primary" type="submit">Save printer to bridge</button>
          <p class="message" id="message"></p>
        </form>
      </div>
    </main>

    <script>
      const list = document.getElementById('printer-list');
      const message = document.getElementById('message');
      const status = document.getElementById('status');
      const form = document.getElementById('printer-form');

      function escapeText(value) {
        return String(value || '').replace(/[&<>"']/g, function (char) {
          return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
        });
      }

      async function request(path, options) {
        const response = await fetch(path, options);
        const body = await response.json().catch(function () { return {}; });
        if (!response.ok) throw new Error(body.error || 'Request failed');
        return body;
      }

      async function load() {
        try {
          const health = await request('/health');
          status.innerHTML =
            '<div class="stat"><span>Bridge</span><strong>Online on port ' + escapeText(health.port) + '</strong></div>' +
            '<div class="stat"><span>Slicer</span><strong>' + escapeText(health.engine && health.engine.available ? 'Ready' : 'Needs CuraEngine') + '</strong></div>' +
            '<div class="stat"><span>Printers</span><strong>' + escapeText((health.printers || []).length) + ' saved</strong></div>';

          const data = await request('/printers?includeLan=1');
          renderPrinters(data.printers || []);
        } catch (err) {
          list.innerHTML = '<p>Bridge setup could not load: ' + escapeText(err.message) + '</p>';
        }
      }

      function renderPrinters(printers) {
        if (!printers.length) {
          list.innerHTML = '<p>No printers yet. Add the printer here, then refresh the iPhone app.</p>';
          return;
        }

        list.innerHTML = printers.map(function (printer) {
          return '<div class="printer-row">' +
            '<div><strong>' + escapeText(printer.name) + '</strong><small>' +
            escapeText(printer.model || 'Bambu') + ' at ' + escapeText(printer.ip || 'LAN IP missing') +
            '</small></div>' +
            '<div class="row-actions">' +
            '<button class="secondary" type="button" data-action="test" data-id="' + escapeText(printer.id) + '">Test</button>' +
            '<button class="danger" type="button" data-action="delete" data-id="' + escapeText(printer.id) + '">Remove</button>' +
            '</div></div>';
        }).join('');
      }

      form.addEventListener('submit', async function (event) {
        event.preventDefault();
        message.textContent = 'Saving printer...';
        const data = Object.fromEntries(new FormData(form).entries());
        try {
          await request('/printers', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
          });
          form.reset();
          message.textContent = 'Saved. Refresh the iPhone Printers tab.';
          await load();
        } catch (err) {
          message.textContent = err.message;
        }
      });

      list.addEventListener('click', async function (event) {
        const button = event.target.closest('button');
        if (!button) return;
        const id = button.dataset.id;
        const action = button.dataset.action;
        button.disabled = true;
        try {
          if (action === 'test') {
            await request('/printers/' + encodeURIComponent(id) + '/test', { method: 'POST' });
            message.textContent = 'Printer answered through the bridge.';
          }
          if (action === 'delete') {
            await request('/printers/' + encodeURIComponent(id), { method: 'DELETE' });
            message.textContent = 'Printer removed.';
            await load();
          }
        } catch (err) {
          message.textContent = err.message;
        } finally {
          button.disabled = false;
        }
      });

      load();
    </script>
  </body>
</html>`;
}

function commandExists(command) {
  try {
    const { execSync } = require('child_process');
    return execSync(`command -v ${command}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

function findCuraEngine() {
  const possiblePaths = [
    process.env.CURA_ENGINE_PATH,
    '/usr/local/bin/CuraEngine',
    '/usr/bin/CuraEngine',
    '/opt/homebrew/bin/CuraEngine',
    '/Applications/UltiMaker Cura.app/Contents/MacOS/CuraEngine',
    path.join(ROOT_DIR, 'CuraEngine'),
    '/app/CuraEngine',
    commandExists('CuraEngine'),
  ].filter(Boolean);

  return possiblePaths.find((p) => fs.existsSync(p)) || null;
}

function findCuraDefinition() {
  const possiblePaths = [
    process.env.CURA_DEFINITION_PATH,
    '/usr/share/cura/resources/definitions/fdmprinter.def.json',
    '/usr/share/cura/resources/definitions/creality_base.def.json',
    '/Applications/UltiMaker Cura.app/Contents/Resources/share/cura/resources/definitions/fdmprinter.def.json',
  ].filter(Boolean);

  return possiblePaths.find((p) => fs.existsSync(p)) || null;
}

/** Bambu Studio when it is installed (real Bambu profiles), otherwise CuraEngine. */
function bestEngine() {
  const bambu = bambuSlicer.status();
  if (bambu.available) return bambu;
  const cura = engineStatus();
  return cura.available ? cura : bambu;
}

function engineStatus() {
  const curaPath = findCuraEngine();
  const definitionPath = findCuraDefinition();
  return {
    name: 'CuraEngine',
    available: Boolean(curaPath && definitionPath),
    executable: curaPath,
    definition: definitionPath,
    note: curaPath && !definitionPath
      ? 'CuraEngine was found, but no printer definition was found. Set CURA_DEFINITION_PATH.'
      : undefined,
  };
}

function buildCuraArgs(modelPath, gcodePath, settings) {
  const definitionPath = findCuraDefinition();
  if (!definitionPath) {
    throw new Error('Cura printer definition not found. Set CURA_DEFINITION_PATH or install Cura resources.');
  }

  const args = ['slice', '-j', definitionPath, '-o', gcodePath, '-l', modelPath];

  const printerModel = settings.printerModel || 'P1S';
  const isMini = printerModel === 'A1Mini';
  const settingsMap = {
    layer_height: settings.layerHeight || 0.2,
    infill_sparse_density: settings.infillDensity || 15,
    wall_line_count: settings.wallCount || 3,
    top_layers: settings.topLayers || 4,
    bottom_layers: settings.bottomLayers || 4,
    support_enable: settings.supportEnabled ? 'True' : 'False',
    speed_print: settings.printSpeed || 250,
    material_print_temperature: settings.temperature || 220,
    material_bed_temperature: settings.bedTemperature || 60,
    cool_fan_speed: settings.fanSpeed || 100,
    machine_width: isMini ? 180 : 256,
    machine_depth: isMini ? 180 : 256,
    machine_height: isMini ? 180 : 256,
    machine_center_is_zero: 'False',
    machine_nozzle_size: settings.nozzleSize || 0.4,
    adhesion_type: settings.adhesionType || 'skirt',
    infill_pattern: settings.infillPattern || 'grid',
  };

  if (settings.supportEnabled) {
    settingsMap.support_structure = settings.supportType === 'tree' ? 'tree' : 'normal';
  }

  for (const [key, value] of Object.entries(settingsMap)) {
    args.push('-s', `${key}=${value}`);
  }

  return args;
}

function sliceWithCura(modelPath, gcodePath, settings) {
  return new Promise((resolve, reject) => {
    const curaPath = findCuraEngine();
    if (!curaPath) {
      reject(new Error('CuraEngine is not installed. Install CuraEngine on the bridge machine before slicing.'));
      return;
    }

    let args;
    try {
      args = buildCuraArgs(modelPath, gcodePath, settings);
    } catch (err) {
      reject(err);
      return;
    }

    execFile(curaPath, args, { timeout: 15 * 60 * 1000 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || stdout || error.message));
        return;
      }
      if (!fs.existsSync(gcodePath)) {
        reject(new Error('Slicer completed but did not write a G-code file.'));
        return;
      }
      resolve(parseGcodeStats(gcodePath));
    });
  });
}

function parseGcodeStats(gcodePath) {
  try {
    const content = fs.readFileSync(gcodePath, 'utf8');
    const lines = content.split('\n');

    let totalE = 0;
    let totalTime = 0;

    for (const line of lines) {
      const timeMatch = line.match(/;TIME:(\d+)/);
      if (timeMatch) totalTime = parseInt(timeMatch[1], 10);

      const filamentMatch = line.match(/;Filament used:\s*([\d.]+)m/i);
      if (filamentMatch) totalE = parseFloat(filamentMatch[1]) * 1000;

      const eMatch = line.match(/\sE([\d.]+)/);
      if (eMatch && !line.startsWith(';')) {
        const e = parseFloat(eMatch[1]);
        if (Number.isFinite(e) && e > totalE) totalE = e;
      }
    }

    const filamentGrams = totalE * 0.00243 * 1.24;
    return {
      estimatedTime: totalTime || undefined,
      estimatedFilament: Number.isFinite(filamentGrams) && filamentGrams > 0
        ? Math.round(filamentGrams * 10) / 10
        : undefined,
    };
  } catch {
    return {};
  }
}

async function uploadToPrinter(printer, sourcePath, targetFileName) {
  const client = new ftp.Client(30_000);
  client.ftp.verbose = process.env.DEBUG_FTP === '1';

  try {
    await client.access({
      host: printer.ip,
      port: Number(printer.ftpPort || 990),
      user: 'bblp',
      password: printer.accessCode,
      secure: 'implicit',
      secureOptions: { rejectUnauthorized: false },
    });
    await client.uploadFrom(sourcePath, targetFileName);
  } finally {
    client.close();
  }
}

function publishPrinterCommand(printer, payload) {
  return new Promise((resolve, reject) => {
    const client = mqtt.connect({
      host: printer.ip,
      port: Number(printer.mqttPort || 8883),
      protocol: 'mqtts',
      username: 'bblp',
      password: printer.accessCode,
      rejectUnauthorized: false,
      connectTimeout: 10_000,
      reconnectPeriod: 0,
    });

    const timeout = setTimeout(() => {
      client.end(true);
      reject(new Error('Timed out connecting to printer MQTT.'));
    }, 15_000);

    client.on('connect', () => {
      const topic = `device/${printer.serialNumber}/request`;
      client.publish(topic, JSON.stringify(payload), { qos: 0 }, (err) => {
        clearTimeout(timeout);
        client.end(true);
        if (err) reject(err);
        else resolve();
      });
    });

    client.on('error', (err) => {
      clearTimeout(timeout);
      client.end(true);
      reject(err);
    });
  });
}

async function testPrinter(printer) {
  const payload = {
    pushing: {
      sequence_id: String(Date.now()),
      command: 'pushall',
    },
  };
  await publishPrinterCommand(printer, payload);
}

/** Sends a sliced Bambu project (.gcode.3mf) and starts plate 1. */
async function printProject(printer, filePath, originalName, options = {}) {
  if (!fs.existsSync(filePath)) throw new Error('Sliced file not found on bridge. Re-slice and try again.');
  const base = path.parse(sanitizeModelName(originalName, 'print.stl')).name.slice(0, 40);
  const targetFileName = `${base}_${Date.now()}.gcode.3mf`.replace(/_+/g, '_');
  await uploadToPrinter(printer, filePath, targetFileName);

  // X1 printers read from the FTP root; P1 and A1 printers read from the SD card path.
  const isX1 = /^X1/.test(printer.model || '');
  const useAms = Boolean(options.useAms ?? printer.useAms ?? false);
  const payload = {
    print: {
      sequence_id: String(Date.now()),
      command: 'project_file',
      param: 'Metadata/plate_1.gcode',
      project_id: '0',
      profile_id: '0',
      task_id: '0',
      subtask_id: '0',
      subtask_name: base,
      file: '',
      url: isX1 ? `ftp:///${targetFileName}` : `file:///sdcard/${targetFileName}`,
      md5: '',
      timelapse: false,
      bed_type: 'auto',
      bed_levelling: options.bedLevelling !== false,
      flow_cali: true,
      vibration_cali: true,
      layer_inspect: false,
      use_ams: useAms,
      ams_mapping: useAms ? [Number(options.amsSlot || 0)] : [],
    },
  };
  await publishPrinterCommand(printer, payload);
  return { targetFileName };
}

async function printGcode(printer, gcodePath, originalName) {
  if (!fs.existsSync(gcodePath)) throw new Error('G-code file not found on bridge.');

  const targetFileName = sanitizePrinterFileName(originalName);
  await uploadToPrinter(printer, gcodePath, targetFileName);

  const payload = {
    print: {
      sequence_id: String(Date.now()),
      command: 'gcode_file',
      param: targetFileName,
    },
  };
  await publishPrinterCommand(printer, payload);

  return { targetFileName };
}

// ---- Pairing and access ------------------------------------------------------

/** The pairing code is made once and kept; the phone derives everything from it. */
function pairingCode() {
  const config = readConfig();
  if (!config.pairingCode) {
    config.pairingCode = remote.newCode();
    writeConfig(config);
  }
  return config.pairingCode;
}

const PAIRING = remote.derive(pairingCode());

function isPrivateAddress(address) {
  const ip = String(address || '').replace(/^::ffff:/, '');
  return ip === '127.0.0.1' || ip === '::1' || /^10\./.test(ip) || /^192\.168\./.test(ip)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(ip) || /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip) || /^f[cd]/i.test(ip);
}

/** True for requests that arrived through the public tunnel rather than from the home network. */
function cameThroughTunnel(req) {
  return Boolean(req.headers['cf-connecting-ip'] || req.headers['cf-ray'] || req.headers['x-forwarded-for']);
}

function hasToken(req) {
  const header = String(req.headers.authorization || '');
  const given = header.startsWith('Bearer ') ? header.slice(7) : String(req.query.access_token || '');
  if (given.length !== PAIRING.token.length) return false;
  return require('crypto').timingSafeEqual(Buffer.from(given), Buffer.from(PAIRING.token));
}

// Setup pages show printer details and the pairing code: home network only, never the tunnel.
const HOME_ONLY = [/^\/$/, /^\/setup/, /^\/pair/];

app.use((req, res, next) => {
  const local = isPrivateAddress(req.socket.remoteAddress) && !cameThroughTunnel(req);
  if (HOME_ONLY.some((pattern) => pattern.test(req.path))) {
    if (local) return next();
    return res.status(403).json({ error: 'Open this page from a computer on the same network as the bridge.' });
  }
  if (local || hasToken(req)) return next();
  res.status(401).json({ error: 'This phone is not paired with the bridge. Scan the pairing code again.' });
});

app.use('/gcode', express.static(GCODE_DIR));

let link = { state: { url: null, status: 'off', note: null } };

app.get('/pair', async (_req, res, next) => {
  try {
    const code = pairingCode();
    const qr = await QRCode.toString(`islicer://pair?c=${code}`, { type: 'svg', margin: 1, width: 260 });
    res.type('html').send(pairPageHtml(code, qr));
  } catch (err) {
    next(err);
  }
});

// The same code as text, for the installer to print in a terminal.
app.get('/pair/terminal', async (_req, res, next) => {
  try {
    const code = pairingCode();
    const qr = await QRCode.toString(`islicer://pair?c=${code}`, { type: 'terminal', small: true });
    res.type('text').send(`${qr}\nOr type this code in the app:  ${code}\n`);
  } catch (err) {
    next(err);
  }
});

app.get('/pair/status', (_req, res) => {
  res.json({ status: link.state.status, note: link.state.note, online: link.state.status === 'online' });
});

function pairPageHtml(code, qrSvg) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pair your phone</title><style>
body{font:17px -apple-system,system-ui,Segoe UI,sans-serif;background:#0b0c0f;color:#f3f4f6;margin:0;display:grid;place-items:center;min-height:100vh}
main{max-width:420px;padding:28px;text-align:center}h1{font-size:26px;margin:0 0 6px}p{color:#a5acb8;line-height:1.45}
.qr{background:#fff;border-radius:22px;padding:14px;display:inline-block;margin:18px 0}.code{font:600 26px ui-monospace,Menlo,monospace;letter-spacing:2px;color:#34d399}
.pill{display:inline-block;border-radius:999px;padding:6px 14px;font-size:14px;background:#1f2430;margin-top:14px}a{color:#34d399}
</style></head><body><main>
<h1>Pair your phone</h1>
<p>Open iSlicer on your iPhone and scan this code. You only do this once.</p>
<div class="qr">${qrSvg}</div>
<p>Or type this code in the app:</p><div class="code">${code}</div>
<div class="pill" id="pill">Checking remote access…</div>
<p style="margin-top:22px;font-size:14px">Next: <a href="/setup">add your printer</a>. Keep this code private: anyone with it can print on your printer.</p>
<script>
async function tick(){try{const r=await fetch('/pair/status');const s=await r.json();
document.getElementById('pill').textContent=s.online?'Remote access: ready, works from anywhere':(s.note||'Remote access: '+s.status);}catch(e){}}
tick();setInterval(tick,4000);
</script></main></body></html>`;
}

app.get('/health', (_req, res) => {
  const config = readConfig();
  res.json({
    status: 'ok',
    name: 'BambuSlicer Bridge',
    version: VERSION,
    port: PORT,
    localAddresses: getLocalAddresses(),
    engine: bestEngine(),
    options: bambuSlicer.listOptions(),
    remote: { status: link.state.status },
    printers: config.printers.map((printer) => publicPrinter(printer)),
  });
});

app.get('/', (_req, res) => {
  res.redirect('/setup');
});

app.get('/setup', (_req, res) => {
  res.type('html').send(setupPageHtml());
});

app.get('/printers', (req, res) => {
  const config = readConfig();
  const includeLan = req.query.includeLan === '1';
  res.json({ printers: config.printers.map((printer) => publicPrinter(printer, { includeLan })) });
});

app.post('/printers', (req, res, next) => {
  try {
    const fields = requirePrinterFields(req.body);
    const config = readConfig();
    const id = req.body.id || `printer_${Date.now()}`;
    const existingIndex = config.printers.findIndex((p) => p.id === id);
    const printer = {
      ...(existingIndex >= 0 ? config.printers[existingIndex] : {}),
      id,
      ...fields,
      createdAt: existingIndex >= 0 ? config.printers[existingIndex].createdAt : Date.now(),
      updatedAt: Date.now(),
    };

    if (existingIndex >= 0) config.printers[existingIndex] = printer;
    else config.printers.push(printer);

    writeConfig(config);
    res.json({ printer: publicPrinter(printer) });
  } catch (err) {
    next(err);
  }
});

app.delete('/printers/:id', (req, res) => {
  const config = readConfig();
  const before = config.printers.length;
  config.printers = config.printers.filter((p) => p.id !== req.params.id);
  writeConfig(config);
  res.json({ ok: before !== config.printers.length });
});

app.post('/printers/:id/test', async (req, res, next) => {
  try {
    const printer = getPrinter(req.params.id);
    await testPrinter(printer);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

app.post('/slice', upload.single('model'), async (req, res, next) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No model file uploaded.' });
      return;
    }

    const settings = JSON.parse(req.body.settings || '{}');
    const filename = sanitizeModelName(req.body.filename || req.file.originalname || 'model.stl');
    const jobId = uuidv4();
    const ext = path.extname(filename).toLowerCase();
    const modelPath = path.join(UPLOAD_DIR, `${jobId}${ext}`);
    const useBambu = bambuSlicer.status().available;
    const gcodePath = path.join(GCODE_DIR, useBambu ? `${jobId}.gcode.3mf` : `${jobId}.gcode`);

    fs.renameSync(req.file.path, modelPath);

    setJob(jobId, {
      id: jobId,
      status: 'slicing',
      progress: 5,
      filename,
      modelPath,
      gcodePath,
      startedAt: Date.now(),
    });

    res.json({ jobId, statusUrl: `/status/${jobId}` });

    try {
      const stats = useBambu
        ? await bambuSlicer.slice(modelPath, GCODE_DIR, jobId, settings)
        : await sliceWithCura(modelPath, gcodePath, settings);
      const { filePath: _filePath, ...publicStats } = stats;
      setJob(jobId, {
        ...jobs.get(jobId),
        status: 'done',
        progress: 100,
        engine: useBambu ? 'bambu-studio' : 'cura',
        gcodeUrl: `/gcode/${path.basename(gcodePath)}`,
        completedAt: Date.now(),
        ...publicStats,
      });
    } catch (err) {
      setJob(jobId, {
        ...jobs.get(jobId),
        status: 'error',
        progress: 100,
        error: err.message,
        completedAt: Date.now(),
      });
    }
  } catch (err) {
    next(err);
  }
});

app.get('/status/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: 'Job not found.' });
    return;
  }

  const { modelPath, gcodePath, ...safeJob } = job;
  res.json(safeJob);
});

app.post('/print', async (req, res, next) => {
  try {
    const { printerId, jobId } = req.body;
    if (!printerId || !jobId) {
      res.status(400).json({ error: 'printerId and jobId are required.' });
      return;
    }

    const printer = getPrinter(printerId);
    const job = jobs.get(jobId);
    if (!job) {
      res.status(404).json({ error: 'Slice job not found on bridge. Re-slice the file and try again.' });
      return;
    }
    if (job.status !== 'done') {
      res.status(409).json({ error: `Slice job is ${job.status}.` });
      return;
    }

    const result = String(job.gcodePath).endsWith('.3mf')
      ? await printProject(printer, job.gcodePath, job.filename, req.body)
      : await printGcode(printer, job.gcodePath, job.filename);
    res.json({ ok: true, ...result });
  } catch (err) {
    next(err);
  }
});

app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  res.status(status).json({ error: err.message || 'Unexpected server error.' });
});

app.listen(PORT, '0.0.0.0', async () => {
  const engine = bestEngine();
  const code = pairingCode();
  console.log(`iSlicer Bridge ${VERSION} running on port ${PORT}`);
  console.log(`Slicer: ${engine.available ? `${engine.name} (${engine.executable})` : 'not ready'}`);
  if (engine.note) console.log(`Slicer note: ${engine.note}`);
  console.log(`\nPair your phone: open http://localhost:${PORT}/pair, or scan this in the iSlicer app:\n`);
  try {
    console.log(await QRCode.toString(`islicer://pair?c=${code}`, { type: 'terminal', small: true }));
  } catch {}
  console.log(`Pairing code: ${code}\n`);
  if (process.env.ISLICER_REMOTE !== 'off') {
    link = remote.start({ port: PORT, code });
  }
});
