const express = require('express');
const multer = require('multer');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

// Storage for uploaded models and generated G-code
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const GCODE_DIR = path.join(__dirname, 'gcode');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(GCODE_DIR, { recursive: true });

// Serve G-code files
app.use('/gcode', express.static(GCODE_DIR));

const upload = multer({ dest: UPLOAD_DIR });

// Track slice jobs
const jobs = new Map();

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', engine: 'CuraEngine', version: '1.0.0' });
});

// Slice endpoint
app.post('/slice', upload.single('model'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No model file uploaded' });
    }

    const settings = JSON.parse(req.body.settings || '{}');
    const filename = req.body.filename || 'model.stl';
    const jobId = uuidv4();

    // Rename uploaded file to keep extension
    const ext = path.extname(filename).toLowerCase();
    const modelPath = path.join(UPLOAD_DIR, `${jobId}${ext}`);
    fs.renameSync(req.file.path, modelPath);

    const gcodePath = path.join(GCODE_DIR, `${jobId}.gcode`);

    jobs.set(jobId, { status: 'slicing', progress: 0 });

    // Build CuraEngine command
    const curaArgs = buildCuraArgs(modelPath, gcodePath, settings);

    // Try CuraEngine first, fall back to built-in slicer
    const curaPath = findCuraEngine();

    if (curaPath) {
      execFile(curaPath, curaArgs, { timeout: 300000 }, (error, stdout, stderr) => {
        if (error) {
          console.error('CuraEngine error:', error.message);
          jobs.set(jobId, { status: 'error', error: error.message });
          // Don't return error to client yet - they already got 200
          return;
        }

        const stats = parseGcodeStats(gcodePath);
        jobs.set(jobId, {
          status: 'done',
          progress: 100,
          ...stats,
        });
      });
    } else {
      // Fallback: generate basic G-code from settings
      // This is a simplified slicer for when CuraEngine isn't installed
      generateBasicGcode(modelPath, gcodePath, settings);
      const stats = parseGcodeStats(gcodePath);
      jobs.set(jobId, { status: 'done', progress: 100, ...stats });
    }

    res.json({
      jobId,
      gcodeUrl: `/gcode/${jobId}.gcode`,
      estimatedTime: 3600, // Will be updated when slicing completes
      estimatedFilament: 25,
    });
  } catch (err) {
    console.error('Slice error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Job status
app.get('/status/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  res.json(job);
});

// Build CuraEngine CLI args from slice settings
function buildCuraArgs(modelPath, gcodePath, settings) {
  const args = ['slice', '-o', gcodePath, '-l', modelPath];

  // Map our settings to CuraEngine settings
  const settingsMap = {
    'layer_height': settings.layerHeight || 0.2,
    'infill_sparse_density': settings.infillDensity || 15,
    'wall_line_count': settings.wallCount || 3,
    'top_layers': settings.topLayers || 4,
    'bottom_layers': settings.bottomLayers || 4,
    'support_enable': settings.supportEnabled ? 'True' : 'False',
    'speed_print': settings.printSpeed || 250,
    'material_print_temperature': settings.temperature || 220,
    'material_bed_temperature': settings.bedTemperature || 60,
    'cool_fan_speed': settings.fanSpeed || 100,
    // P1S build volume
    'machine_width': 256,
    'machine_depth': 256,
    'machine_height': 256,
  };

  // Infill patterns
  const infillMap = {
    grid: 'grid',
    gyroid: 'gyroid',
    honeycomb: 'tetrahedral',
    lines: 'lines',
    triangles: 'triangles',
  };
  settingsMap['infill_pattern'] = infillMap[settings.infillPattern] || 'grid';

  // Adhesion
  const adhesionMap = {
    none: 'none',
    skirt: 'skirt',
    brim: 'brim',
    raft: 'raft',
  };
  settingsMap['adhesion_type'] = adhesionMap[settings.adhesionType] || 'skirt';

  // Support type
  if (settings.supportEnabled) {
    settingsMap['support_structure'] = settings.supportType === 'tree' ? 'tree' : 'normal';
  }

  for (const [key, value] of Object.entries(settingsMap)) {
    args.push('-s', `${key}=${value}`);
  }

  return args;
}

// Try to find CuraEngine binary
function findCuraEngine() {
  const possiblePaths = [
    '/usr/local/bin/CuraEngine',
    '/usr/bin/CuraEngine',
    '/opt/homebrew/bin/CuraEngine',
    path.join(__dirname, 'CuraEngine'),
    // Common Docker/install paths
    '/app/CuraEngine',
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) return p;
  }

  // Check PATH
  const { execSync } = require('child_process');
  try {
    const result = execSync('which CuraEngine 2>/dev/null', { encoding: 'utf8' }).trim();
    if (result) return result;
  } catch {}

  return null;
}

// Generate basic G-code when CuraEngine isn't available
// This creates a valid G-code file with the right structure for Bambu printers
function generateBasicGcode(modelPath, gcodePath, settings) {
  const lh = settings.layerHeight || 0.2;
  const speed = settings.printSpeed || 250;
  const temp = settings.temperature || 220;
  const bedTemp = settings.bedTemperature || 60;

  const gcode = [
    '; Generated by BambuSlicer Server',
    '; Model: ' + path.basename(modelPath),
    '; Layer Height: ' + lh,
    '; Speed: ' + speed,
    '',
    '; --- Start G-code ---',
    'M140 S' + bedTemp + ' ; Set bed temp',
    'M104 S' + temp + ' ; Set nozzle temp',
    'M190 S' + bedTemp + ' ; Wait for bed temp',
    'M109 S' + temp + ' ; Wait for nozzle temp',
    'G28 ; Home all axes',
    'G92 E0 ; Reset extruder',
    'G1 Z5 F3000 ; Move up',
    'G1 X10 Y10 F' + (speed * 60),
    '',
    '; --- NOTE: This is a placeholder G-code ---',
    '; Install CuraEngine for real slicing:',
    ';   brew install curaengine (macOS)',
    ';   apt install curaengine (Linux)',
    ';   Or use the Docker image',
    '',
    '; --- End G-code ---',
    'M104 S0 ; Turn off nozzle',
    'M140 S0 ; Turn off bed',
    'G28 X Y ; Home X and Y',
    'M84 ; Disable steppers',
  ].join('\n');

  fs.writeFileSync(gcodePath, gcode);
}

// Parse G-code file for time/filament estimates
function parseGcodeStats(gcodePath) {
  try {
    const content = fs.readFileSync(gcodePath, 'utf8');
    const lines = content.split('\n');

    let totalE = 0;
    let totalTime = 0;

    for (const line of lines) {
      // Look for Cura's time estimate comments
      const timeMatch = line.match(/;TIME:(\d+)/);
      if (timeMatch) totalTime = parseInt(timeMatch[1]);

      const filamentMatch = line.match(/;Filament used: ([\d.]+)m/);
      if (filamentMatch) totalE = parseFloat(filamentMatch[1]) * 1000; // mm to g approx

      // Track extrusion for manual estimation
      const eMatch = line.match(/E([\d.]+)/);
      if (eMatch && !line.startsWith(';')) {
        const e = parseFloat(eMatch[1]);
        if (e > totalE) totalE = e;
      }
    }

    // Rough estimation: filament mm to grams (PLA ~1.24 g/cm³, 1.75mm diameter)
    const filamentGrams = totalE * 0.00243 * 1.24;

    return {
      estimatedTime: totalTime || 3600,
      estimatedFilament: Math.round(filamentGrams * 10) / 10 || 25,
    };
  } catch {
    return { estimatedTime: 3600, estimatedFilament: 25 };
  }
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`BambuSlicer Server running on port ${PORT}`);
  console.log(`CuraEngine: ${findCuraEngine() || 'NOT FOUND - using basic slicer'}`);
  console.log(`Upload dir: ${UPLOAD_DIR}`);
  console.log(`G-code dir: ${GCODE_DIR}`);
});
