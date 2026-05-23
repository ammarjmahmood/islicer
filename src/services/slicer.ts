import { Paths, File, Directory } from 'expo-file-system';
import { SliceSettings, SliceJob } from '../types';
import { saveSliceJob } from './storage';
import { resolveBridgeUrl } from './bridge';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function finishSliceJob(job: SliceJob, serverUrl: string, serverJobId: string) {
  try {
    let remoteStatus: any = null;
    const startedPolling = Date.now();
    while (Date.now() - startedPolling < 20 * 60 * 1000) {
      const statusResponse = await fetch(`${serverUrl}/status/${serverJobId}`);
      if (!statusResponse.ok) {
        throw new Error(await statusResponse.text());
      }
      remoteStatus = await statusResponse.json();
      job.progress = remoteStatus.progress || job.progress;
      await saveSliceJob(job);

      if (remoteStatus.status === 'done') break;
      if (remoteStatus.status === 'error') {
        throw new Error(remoteStatus.error || 'Slicing failed on bridge.');
      }

      await sleep(2000);
    }

    if (!remoteStatus || remoteStatus.status !== 'done' || !remoteStatus.gcodeUrl) {
      throw new Error('Slicing timed out on bridge.');
    }

    const gcodeDir = new Directory(Paths.document, 'gcode');
    gcodeDir.create();
    const downloaded = await File.downloadFileAsync(`${serverUrl}${remoteStatus.gcodeUrl}`, gcodeDir);

    job.status = 'done';
    job.progress = 100;
    job.gcodeUri = downloaded.uri;
    job.estimatedTime = remoteStatus.estimatedTime;
    job.estimatedFilament = remoteStatus.estimatedFilament;
    job.completedAt = Date.now();
    await saveSliceJob(job);
  } catch (err: any) {
    job.status = 'error';
    job.progress = 100;
    job.error = err.message;
    job.completedAt = Date.now();
    await saveSliceJob(job);
  }
}

export async function startSliceJob(
  modelUri: string,
  modelName: string,
  settings: SliceSettings,
  presetName: string,
): Promise<SliceJob> {
  const serverUrl = await resolveBridgeUrl();

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
    job.serverJobId = result.jobId;
    job.progress = 10;
    await saveSliceJob(job);

    void finishSliceJob(job, serverUrl, result.jobId);
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
    const serverUrl = await resolveBridgeUrl();
    const response = await fetch(`${serverUrl}/status/${jobId}`);
    const data = await response.json();
    onProgress(data.progress || 0);
    return data;
  } catch {
    return null;
  }
}
