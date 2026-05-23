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

const app = express();
const PORT = Number(process.env.PORT || 8005);
const VERSION = '2.0.0';

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

app.use('/gcode', express.static(GCODE_DIR));

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

function publicPrinter(printer) {
  const { accessCode, ...safe } = printer;
  return {
    ...safe,
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

app.get('/health', (_req, res) => {
  const config = readConfig();
  res.json({
    status: 'ok',
    name: 'BambuSlicer Bridge',
    version: VERSION,
    port: PORT,
    localAddresses: getLocalAddresses(),
    engine: engineStatus(),
    printers: config.printers.map(publicPrinter),
  });
});

app.get('/printers', (_req, res) => {
  const config = readConfig();
  res.json({ printers: config.printers.map(publicPrinter) });
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
    const gcodePath = path.join(GCODE_DIR, `${jobId}.gcode`);

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
      const stats = await sliceWithCura(modelPath, gcodePath, settings);
      setJob(jobId, {
        ...jobs.get(jobId),
        status: 'done',
        progress: 100,
        gcodeUrl: `/gcode/${jobId}.gcode`,
        completedAt: Date.now(),
        ...stats,
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

    const result = await printGcode(printer, job.gcodePath, job.filename);
    res.json({ ok: true, ...result });
  } catch (err) {
    next(err);
  }
});

app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  res.status(status).json({ error: err.message || 'Unexpected server error.' });
});

app.listen(PORT, '0.0.0.0', () => {
  const engine = engineStatus();
  console.log(`BambuSlicer Bridge ${VERSION} running on port ${PORT}`);
  console.log(`Engine: ${engine.available ? `${engine.name} (${engine.executable})` : 'not ready'}`);
  if (engine.note) console.log(`Engine note: ${engine.note}`);
  console.log(`Data dir: ${DATA_DIR}`);
});
