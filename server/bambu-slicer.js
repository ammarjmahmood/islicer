// Slices with the real Bambu Studio (or OrcaSlicer) engine in command-line mode,
// using Bambu's own printer, process and filament profiles.
//
// The command line does not follow the "inherits" / "include" chain in Bambu's
// profile files, so this module flattens each profile before handing it over.
// Without that, the output silently uses generic start/end G-code.
const { execFile, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOME = os.homedir();
const LOCAL_DIR = path.join(HOME, '.local', 'share', 'islicer');

// [executable, profiles/BBL directory]
const INSTALLS = [
  [process.env.BAMBU_STUDIO_PATH, process.env.BAMBU_PROFILES_DIR],
  // Linux: AppImage unpacked by install.sh
  [path.join(LOCAL_DIR, 'bambustudio', 'AppRun'), path.join(LOCAL_DIR, 'bambustudio', 'resources', 'profiles', 'BBL')],
  [path.join(LOCAL_DIR, 'bambustudio', 'bin', 'bambu-studio'), path.join(LOCAL_DIR, 'bambustudio', 'resources', 'profiles', 'BBL')],
  ['/usr/bin/bambu-studio', '/usr/share/BambuStudio/profiles/BBL'],
  ['/usr/bin/bambu-studio', '/usr/share/bambu-studio/resources/profiles/BBL'],
  // macOS
  ['/Applications/BambuStudio.app/Contents/MacOS/BambuStudio', '/Applications/BambuStudio.app/Contents/Resources/profiles/BBL'],
  // OrcaSlicer speaks the same command line
  [path.join(LOCAL_DIR, 'orcaslicer', 'AppRun'), path.join(LOCAL_DIR, 'orcaslicer', 'resources', 'profiles', 'BBL')],
  ['/Applications/OrcaSlicer.app/Contents/MacOS/OrcaSlicer', '/Applications/OrcaSlicer.app/Contents/Resources/profiles/BBL'],
];

function findInstall() {
  for (const [exe, profiles] of INSTALLS) {
    if (exe && profiles && fs.existsSync(exe) && fs.existsSync(path.join(profiles, 'machine'))) {
      return { exe, profiles };
    }
  }
  return null;
}

function status() {
  const install = findInstall();
  return {
    name: 'Bambu Studio',
    available: Boolean(install),
    executable: install ? install.exe : null,
    note: install ? undefined : 'Bambu Studio was not found. Run the installer again, or set BAMBU_STUDIO_PATH and BAMBU_PROFILES_DIR.',
  };
}

// ---- Profiles -------------------------------------------------------------

const indexCache = new Map();

/** name -> parsed JSON, for one category folder (machine / process / filament). */
function loadCategory(profiles, category) {
  const key = `${profiles}|${category}`;
  if (indexCache.has(key)) return indexCache.get(key);
  const dir = path.join(profiles, category);
  const index = new Map();
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.json')) continue;
    try {
      const json = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
      if (json.name) index.set(json.name, json);
    } catch {}
  }
  indexCache.set(key, index);
  return index;
}

/** Follows "inherits" and "include" so the result stands on its own. */
function flatten(index, name, depth = 0) {
  const own = index.get(name);
  if (!own) throw new Error(`Bambu profile not found: ${name}`);
  if (depth > 12) throw new Error(`Profile inheritance too deep at ${name}`);
  let merged = own.inherits ? flatten(index, own.inherits, depth + 1) : {};
  merged = { ...merged, ...own };
  const includes = Array.isArray(own.include) ? own.include : [];
  for (const includeName of includes) {
    const part = index.get(includeName);
    if (!part) continue;
    const { name: _n, instantiation: _i, type: _t, ...values } = part;
    merged = { ...merged, ...values };
  }
  delete merged.inherits;
  delete merged.include;
  return merged;
}

const MACHINES = {
  P1S: 'Bambu Lab P1S 0.4 nozzle',
  P1P: 'Bambu Lab P1P 0.4 nozzle',
  X1C: 'Bambu Lab X1 Carbon 0.4 nozzle',
  X1: 'Bambu Lab X1 0.4 nozzle',
  A1: 'Bambu Lab A1 0.4 nozzle',
  A1Mini: 'Bambu Lab A1 mini 0.4 nozzle',
};

const FILAMENTS = {
  PLA: ['Bambu PLA Basic', 'Generic PLA'],
  'PLA Matte': ['Bambu PLA Matte', 'Bambu PLA Basic'],
  PETG: ['Bambu PETG HF', 'Bambu PETG Basic', 'Generic PETG'],
  ABS: ['Bambu ABS', 'Generic ABS'],
  ASA: ['Bambu ASA', 'Generic ASA'],
  TPU: ['Bambu TPU 95A', 'Generic TPU'],
};

const BED_TYPES = { textured: 'Textured PEI Plate', smooth: 'High Temp Plate', cool: 'Cool Plate', engineering: 'Engineering Plate' };
const INFILL = { grid: 'grid', gyroid: 'gyroid', honeycomb: 'honeycomb', lines: 'line', triangles: 'triangles' };

function listOptions() {
  return { printers: Object.keys(MACHINES), filaments: Object.keys(FILAMENTS), layerHeights: [0.08, 0.12, 0.16, 0.2, 0.24, 0.28], bedTypes: Object.keys(BED_TYPES) };
}

/** Picks and flattens the three profiles for a job, then applies the phone's choices. */
function buildProfiles(profiles, settings) {
  const machines = loadCategory(profiles, 'machine');
  const processes = loadCategory(profiles, 'process');
  const filaments = loadCategory(profiles, 'filament');

  const machineName = MACHINES[settings.printerModel] || MACHINES.P1S;
  const machine = flatten(machines, machineName);

  // Process: the printer's default, or its sibling at the requested layer height.
  const defaultProcess = machine.default_print_profile;
  const suffix = defaultProcess.slice(defaultProcess.indexOf('@')); // "@BBL X1C"
  const layer = Number(settings.layerHeight) || 0.2;
  const wanted = [...processes.keys()].find((name) =>
    name.startsWith(`${layer.toFixed(2)}mm `) && name.endsWith(suffix) && processes.get(name).instantiation === 'true'
    && / (Standard|Fine|Optimal|Extra Fine|Draft|Extra Draft|High Quality) @/.test(name) && !/High Quality/.test(name));
  const processJson = flatten(processes, wanted || defaultProcess);
  if (!wanted) processJson.layer_height = String(layer);

  if (settings.infillDensity != null) processJson.sparse_infill_density = `${Math.round(Number(settings.infillDensity))}%`;
  if (settings.infillPattern && INFILL[settings.infillPattern]) processJson.sparse_infill_pattern = INFILL[settings.infillPattern];
  if (settings.wallCount) processJson.wall_loops = String(settings.wallCount);
  if (settings.topLayers) processJson.top_shell_layers = String(settings.topLayers);
  if (settings.bottomLayers) processJson.bottom_shell_layers = String(settings.bottomLayers);
  // Most printers ship with the textured PEI plate, and every common filament is allowed on it.
  processJson.curr_bed_type = BED_TYPES[settings.bedType] || BED_TYPES.textured;
  processJson.enable_support = settings.supportEnabled ? '1' : '0';
  if (settings.supportEnabled) processJson.support_type = settings.supportType === 'tree' ? 'tree(auto)' : 'normal(auto)';
  if (settings.adhesionType === 'brim') processJson.brim_type = 'outer_only';
  else if (settings.adhesionType === 'none' || settings.adhesionType === 'skirt') processJson.brim_type = 'no_brim';
  if (settings.adhesionType === 'raft') processJson.raft_layers = '2';

  // Filament: same family as the printer's default profile.
  const defaultFilament = Array.isArray(machine.default_filament_profile)
    ? machine.default_filament_profile[0] : machine.default_filament_profile;
  const tail = defaultFilament.slice(defaultFilament.indexOf('@')); // "@BBL P1S 0.4 nozzle"
  // Prefer a profile that itself lists this printer as compatible.
  const compatible = (base) => [...filaments.values()].find((f) =>
    f.instantiation === 'true' && f.name.startsWith(`${base} @`)
    && Array.isArray(f.compatible_printers) && f.compatible_printers.includes(machineName));
  let filamentName = null;
  for (const base of [...(FILAMENTS[settings.filament] || []), 'Bambu PLA Basic']) {
    const hit = compatible(base)
      // The P1P has no filament profiles of its own; Bambu Studio uses the X1C ones for it.
      || [`${base} ${tail}`, `${base} ${suffix}`, `${base} @BBL X1C`].map((name) => filaments.get(name)).find(Boolean);
    if (hit) { filamentName = hit.name; break; }
  }
  if (!filamentName && filaments.has(defaultFilament)) filamentName = defaultFilament;
  if (!filamentName) throw new Error(`No Bambu filament profile found for ${machineName}.`);
  const filament = flatten(filaments, filamentName);

  return { machine, process: processJson, filament, names: { machine: machineName, process: processJson.name, filament: filamentName } };
}

// ---- Slicing --------------------------------------------------------------

function hasCommand(name) {
  try {
    execFileSync('sh', ['-c', `command -v ${name}`], { stdio: ['ignore', 'pipe', 'ignore'] });
    return true;
  } catch {
    return false;
  }
}

/**
 * Slices `modelPath` and writes `<outDir>/<jobId>.gcode.3mf`.
 * Resolves to { filePath, estimatedTime (seconds), estimatedFilament (grams), profiles }.
 */
function slice(modelPath, outDir, jobId, settings = {}) {
  return new Promise((resolve, reject) => {
    const install = findInstall();
    if (!install) {
      reject(new Error(status().note));
      return;
    }
    let built;
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'islicer-'));
    try {
      built = buildProfiles(install.profiles, settings);
      for (const key of ['machine', 'process', 'filament']) {
        fs.writeFileSync(path.join(work, `${key}.json`), JSON.stringify(built[key]));
      }
    } catch (err) {
      reject(err);
      return;
    }

    const outName = `${jobId}.gcode.3mf`;
    const args = [
      '--slice', '0', '--arrange', '1', '--orient', settings.autoOrient === false ? '0' : '1',
      '--load-settings', `${path.join(work, 'machine.json')};${path.join(work, 'process.json')}`,
      '--load-filaments', path.join(work, 'filament.json'),
      '--outputdir', work,
      '--export-3mf', outName,
      modelPath,
    ];

    // A Linux box with no screen attached still needs a display for the slicer to start.
    let exe = install.exe;
    let finalArgs = args;
    if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY && hasCommand('xvfb-run')) {
      exe = 'xvfb-run';
      finalArgs = ['-a', install.exe, ...args];
    }

    execFile(exe, finalArgs, { timeout: 30 * 60 * 1000, maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
      const cleanup = () => fs.rmSync(work, { recursive: true, force: true });
      let result = {};
      try { result = JSON.parse(fs.readFileSync(path.join(work, 'result.json'), 'utf8')); } catch {}
      const produced = path.join(work, outName);
      if (!fs.existsSync(produced) || (result.return_code != null && result.return_code !== 0)) {
        const reason = result.error_string && result.error_string !== 'Success.'
          ? result.error_string
          : (error && error.message) || String(stderr || stdout).split('\n').filter(Boolean).slice(-3).join(' ');
        cleanup();
        reject(new Error(`Bambu Studio could not slice this model: ${reason || 'no output was produced.'}`));
        return;
      }
      const filePath = path.join(outDir, outName);
      fs.copyFileSync(produced, filePath);

      const plate = (result.sliced_plates || [])[0] || {};
      let grams;
      let seconds = plate.main_predication ? Math.round(plate.main_predication) : undefined;
      try {
        const gcode = fs.readFileSync(path.join(work, 'plate_1.gcode'), 'utf8').slice(0, 4000);
        const weight = /total filament weight \[g\] : ([\d.]+)/.exec(gcode);
        if (weight) grams = Math.round(parseFloat(weight[1]) * 10) / 10;
        const time = /total estimated time: (?:(\d+)d )?(?:(\d+)h )?(?:(\d+)m )?(?:(\d+)s)?/.exec(gcode);
        if (time) seconds = (+time[1] || 0) * 86400 + (+time[2] || 0) * 3600 + (+time[3] || 0) * 60 + (+time[4] || 0);
      } catch {}
      cleanup();
      resolve({ filePath, estimatedTime: seconds, estimatedFilament: grams, profiles: built.names });
    });
  });
}

module.exports = { status, slice, listOptions, findInstall, buildProfiles };
