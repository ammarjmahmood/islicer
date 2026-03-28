import AsyncStorage from '@react-native-async-storage/async-storage';
import { PrinterConfig, ModelFile, SliceJob } from '../types';

const KEYS = {
  printers: 'bambu_printers',
  models: 'bambu_models',
  sliceJobs: 'bambu_slice_jobs',
  sliceServerUrl: 'bambu_slice_server_url',
};

export async function getPrinters(): Promise<PrinterConfig[]> {
  const data = await AsyncStorage.getItem(KEYS.printers);
  return data ? JSON.parse(data) : [];
}

export async function savePrinter(printer: PrinterConfig): Promise<void> {
  const printers = await getPrinters();
  const idx = printers.findIndex((p) => p.id === printer.id);
  if (idx >= 0) {
    printers[idx] = printer;
  } else {
    printers.push(printer);
  }
  await AsyncStorage.setItem(KEYS.printers, JSON.stringify(printers));
}

export async function removePrinter(id: string): Promise<void> {
  const printers = await getPrinters();
  await AsyncStorage.setItem(
    KEYS.printers,
    JSON.stringify(printers.filter((p) => p.id !== id))
  );
}

export async function getModels(): Promise<ModelFile[]> {
  const data = await AsyncStorage.getItem(KEYS.models);
  return data ? JSON.parse(data) : [];
}

export async function saveModel(model: ModelFile): Promise<void> {
  const models = await getModels();
  models.unshift(model);
  await AsyncStorage.setItem(KEYS.models, JSON.stringify(models));
}

export async function removeModel(id: string): Promise<void> {
  const models = await getModels();
  await AsyncStorage.setItem(
    KEYS.models,
    JSON.stringify(models.filter((m) => m.id !== id))
  );
}

export async function getSliceJobs(): Promise<SliceJob[]> {
  const data = await AsyncStorage.getItem(KEYS.sliceJobs);
  return data ? JSON.parse(data) : [];
}

export async function saveSliceJob(job: SliceJob): Promise<void> {
  const jobs = await getSliceJobs();
  const idx = jobs.findIndex((j) => j.id === job.id);
  if (idx >= 0) {
    jobs[idx] = job;
  } else {
    jobs.unshift(job);
  }
  await AsyncStorage.setItem(KEYS.sliceJobs, JSON.stringify(jobs));
}

export async function getSliceServerUrl(): Promise<string> {
  const url = await AsyncStorage.getItem(KEYS.sliceServerUrl);
  return url || '';
}

export async function setSliceServerUrl(url: string): Promise<void> {
  await AsyncStorage.setItem(KEYS.sliceServerUrl, url);
}
