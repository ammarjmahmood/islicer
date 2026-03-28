import { Paths, File, Directory } from 'expo-file-system';
import { SliceSettings, SliceJob } from '../types';
import { getSliceServerUrl, saveSliceJob } from './storage';

/**
 * Resolve the slicer server URL.
 * User configures this in Settings with their Tailscale IP or custom URL.
 */
async function resolveServerUrl(): Promise<string> {
  const configured = await getSliceServerUrl();
  if (configured) {
    // Quick health check
    try {
      const res = await fetch(`${configured}/health`, { signal: AbortSignal.timeout(5000) });
      if (res.ok) return configured;
    } catch {}
    // Still return it — might be a transient failure
    return configured;
  }

  // Try localhost as last resort (same machine / simulator)
  try {
    const res = await fetch('http://localhost:4000/health', { signal: AbortSignal.timeout(2000) });
    if (res.ok) return 'http://localhost:4000';
  } catch {}

  throw new Error(
    'Slicer server not configured. Go to Settings and enter your server URL.'
  );
}

export async function startSliceJob(
  modelUri: string,
  modelName: string,
  settings: SliceSettings,
  presetName: string,
): Promise<SliceJob> {
  const serverUrl = await resolveServerUrl();

  const jobId = `slice_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const job: SliceJob = {
    id: jobId,
    modelId: modelName,
    modelName,
    status: 'queued',
    progress: 0,
    presetName,
    settings,
    startedAt: Date.now(),
  };

  await saveSliceJob(job);

  try {
    job.status = 'slicing';
    await saveSliceJob(job);

    const formData = new FormData();
    formData.append('model', {
      uri: modelUri,
      name: modelName,
      type: 'application/octet-stream',
    } as any);
    formData.append('settings', JSON.stringify(settings));
    formData.append('filename', modelName);

    const response = await fetch(`${serverUrl}/slice`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Server error: ${errText}`);
    }

    const result = await response.json();

    const gcodeDir = new Directory(Paths.document, 'gcode');
    gcodeDir.create();
    const gcodeFile = new File(gcodeDir, `${jobId}.gcode`);

    await File.downloadFileAsync(`${serverUrl}${result.gcodeUrl}`, gcodeDir);

    job.status = 'done';
    job.progress = 100;
    job.gcodeUri = gcodeFile.uri;
    job.estimatedTime = result.estimatedTime;
    job.estimatedFilament = result.estimatedFilament;
    job.completedAt = Date.now();
    await saveSliceJob(job);

    return job;
  } catch (err: any) {
    job.status = 'error';
    job.error = err.message;
    await saveSliceJob(job);
    throw err;
  }
}

export async function pollSliceStatus(
  jobId: string,
  onProgress: (progress: number) => void,
): Promise<SliceJob | null> {
  try {
    const serverUrl = await resolveServerUrl();
    const response = await fetch(`${serverUrl}/status/${jobId}`);
    const data = await response.json();
    onProgress(data.progress || 0);
    return data;
  } catch {
    return null;
  }
}
