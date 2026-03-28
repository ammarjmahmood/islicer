export interface PrinterConfig {
  id: string;
  name: string;
  ip: string;
  accessCode: string;
  serialNumber: string;
  model: 'P1S' | 'P1P' | 'X1C' | 'X1' | 'A1' | 'A1Mini';
  isOnline: boolean;
}

export interface SliceSettings {
  layerHeight: number;
  infillDensity: number;
  infillPattern: 'grid' | 'gyroid' | 'honeycomb' | 'lines' | 'triangles';
  wallCount: number;
  topLayers: number;
  bottomLayers: number;
  supportEnabled: boolean;
  supportType: 'normal' | 'tree';
  adhesionType: 'none' | 'skirt' | 'brim' | 'raft';
  printSpeed: number;
  temperature: number;
  bedTemperature: number;
  fanSpeed: number;
}

export interface SlicePreset {
  id: string;
  name: string;
  description: string;
  settings: SliceSettings;
}

export interface ModelFile {
  id: string;
  name: string;
  uri: string;
  size: number;
  type: 'stl' | '3mf';
  addedAt: number;
  thumbnailUri?: string;
}

export interface SliceJob {
  id: string;
  modelId: string;
  modelName: string;
  status: 'queued' | 'slicing' | 'done' | 'error';
  progress: number;
  presetName: string;
  settings: SliceSettings;
  gcodeUri?: string;
  estimatedTime?: number;
  estimatedFilament?: number;
  startedAt: number;
  completedAt?: number;
  error?: string;
}

export interface PrintJob {
  id: string;
  sliceJobId: string;
  printerId: string;
  status: 'sending' | 'printing' | 'paused' | 'done' | 'error' | 'cancelled';
  progress: number;
  startedAt: number;
  estimatedEndAt?: number;
}

export type RootStackParamList = {
  Main: undefined;
  SliceSettings: { modelId: string };
  PrinterSetup: undefined;
  PrinterDetail: { printerId: string };
  SliceProgress: { jobId: string };
};

export type MainTabParamList = {
  Files: undefined;
  Slice: undefined;
  Printers: undefined;
  Settings: undefined;
};
