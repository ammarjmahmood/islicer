import { SlicePreset, SliceSettings } from '../types';

export const DEFAULT_SETTINGS: SliceSettings = {
  layerHeight: 0.2,
  infillDensity: 15,
  infillPattern: 'grid',
  wallCount: 3,
  topLayers: 4,
  bottomLayers: 4,
  supportEnabled: false,
  supportType: 'normal',
  adhesionType: 'skirt',
  printSpeed: 250,
  temperature: 220,
  bedTemperature: 60,
  fanSpeed: 100,
};

export const PRESETS: SlicePreset[] = [
  {
    id: 'draft',
    name: 'Draft',
    description: 'Fast prints with lower quality. Great for prototyping.',
    settings: {
      ...DEFAULT_SETTINGS,
      layerHeight: 0.28,
      infillDensity: 10,
      wallCount: 2,
      topLayers: 3,
      bottomLayers: 3,
      printSpeed: 300,
    },
  },
  {
    id: 'normal',
    name: 'Normal',
    description: 'Balanced speed and quality for everyday prints.',
    settings: {
      ...DEFAULT_SETTINGS,
    },
  },
  {
    id: 'fine',
    name: 'Fine',
    description: 'High quality prints with finer details.',
    settings: {
      ...DEFAULT_SETTINGS,
      layerHeight: 0.12,
      infillDensity: 20,
      wallCount: 4,
      topLayers: 5,
      bottomLayers: 5,
      printSpeed: 150,
    },
  },
  {
    id: 'strong',
    name: 'Strong',
    description: 'Maximum strength for functional parts.',
    settings: {
      ...DEFAULT_SETTINGS,
      layerHeight: 0.2,
      infillDensity: 40,
      infillPattern: 'gyroid',
      wallCount: 5,
      topLayers: 6,
      bottomLayers: 6,
      printSpeed: 200,
    },
  },
];
