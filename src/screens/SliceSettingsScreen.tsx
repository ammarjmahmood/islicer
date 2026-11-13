import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Switch,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS } from '../constants/theme';
import { PRESETS } from '../constants/presets';
import { SliceSettings, SlicePreset, ModelFile } from '../types';
import { getModels } from '../services/storage';
import { startSliceJob } from '../services/slicer';
import { getBridgePrinters } from '../services/bambu';

function ChipRow({
  options,
  labels = {},
  value,
  onChange,
}: {
  options: string[];
  labels?: Record<string, string>;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 4 }}>
      {options.map((option) => {
        const selected = option === value;
        return (
          <TouchableOpacity
            key={option}
            onPress={() => onChange(option)}
            style={{
              paddingHorizontal: 14,
              paddingVertical: 9,
              borderRadius: 999,
              backgroundColor: selected ? COLORS.primary : COLORS.surface,
            }}
          >
            <Text style={{ color: selected ? '#fff' : COLORS.text, fontWeight: '600', fontSize: 14 }}>
              {labels[option] || option}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function SettingRow({
  label,
  value,
  unit,
  onDecrease,
  onIncrease,
}: {
  label: string;
  value: number | string;
  unit?: string;
  onDecrease: () => void;
  onIncrease: () => void;
}) {
  return (
    <View style={styles.settingRow}>
      <Text style={styles.settingLabel}>{label}</Text>
      <View style={styles.settingControl}>
        <TouchableOpacity style={styles.settingBtn} onPress={onDecrease}>
          <Ionicons name="remove" size={18} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.settingValue}>
          {value}{unit ? ` ${unit}` : ''}
        </Text>
        <TouchableOpacity style={styles.settingBtn} onPress={onIncrease}>
          <Ionicons name="add" size={18} color={COLORS.text} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default function SliceSettingsScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const modelId = route.params?.modelId;

  const [model, setModel] = useState<ModelFile | null>(null);
  const [selectedPreset, setSelectedPreset] = useState<SlicePreset>(PRESETS[1]); // Normal
  const [settings, setSettings] = useState<SliceSettings>(PRESETS[1].settings);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [slicing, setSlicing] = useState(false);

  useEffect(() => {
    loadModel();
    // Slice for the printer that is set up on the bridge.
    getBridgePrinters()
      .then((printers) => {
        if (printers[0]) setSettings((prev) => ({ ...prev, printerModel: prev.printerModel || printers[0].model }));
      })
      .catch(() => {});
  }, []);

  async function loadModel() {
    const models = await getModels();
    const m = models.find((x) => x.id === modelId);
    setModel(m || null);
  }

  function selectPreset(preset: SlicePreset) {
    setSelectedPreset(preset);
    setSettings((prev) => ({ ...preset.settings, printerModel: prev.printerModel, filament: prev.filament }));
  }

  function updateSetting<K extends keyof SliceSettings>(key: K, value: SliceSettings[K]) {
    setSettings((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSlice() {
    if (!model) return;

    setSlicing(true);
    try {
      const job = await startSliceJob(
        model.uri,
        model.name,
        settings,
        selectedPreset.name,
      );
      navigation.navigate('SliceProgress', { jobId: job.id });
    } catch (err: any) {
      Alert.alert('Slice Failed', err.message);
    } finally {
      setSlicing(false);
    }
  }

  if (!model) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator color={COLORS.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={24} color={COLORS.text} />
        </TouchableOpacity>
        <View style={{ flex: 1, marginLeft: SPACING.md }}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {model.name}
          </Text>
          <Text style={styles.headerSubtitle}>Configure slice settings</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Presets */}
        <Text style={styles.sectionTitle}>Preset</Text>
        <View style={styles.presets}>
          {PRESETS.map((preset) => (
            <TouchableOpacity
              key={preset.id}
              style={[
                styles.presetCard,
                selectedPreset.id === preset.id && styles.presetCardActive,
              ]}
              onPress={() => selectPreset(preset)}
            >
              <Text
                style={[
                  styles.presetName,
                  selectedPreset.id === preset.id && { color: COLORS.primary },
                ]}
              >
                {preset.name}
              </Text>
              <Text style={styles.presetDesc}>{preset.description}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.sectionTitle}>Printer</Text>
        <ChipRow
          options={['P1S', 'P1P', 'X1C', 'X1', 'A1', 'A1Mini']}
          labels={{ A1Mini: 'A1 mini' }}
          value={settings.printerModel || 'P1S'}
          onChange={(value) => updateSetting('printerModel', value as SliceSettings['printerModel'])}
        />
        <Text style={styles.sectionTitle}>Filament</Text>
        <ChipRow
          options={['PLA', 'PLA Matte', 'PETG', 'ABS', 'ASA', 'TPU']}
          value={settings.filament || 'PLA'}
          onChange={(value) => updateSetting('filament', value as SliceSettings['filament'])}
        />

        {/* Key Settings */}
        <Text style={styles.sectionTitle}>Key Settings</Text>
        <View style={styles.settingsCard}>
          <SettingRow
            label="Layer Height"
            value={settings.layerHeight.toFixed(2)}
            unit="mm"
            onDecrease={() =>
              updateSetting('layerHeight', Math.max(0.04, +(settings.layerHeight - 0.04).toFixed(2)))
            }
            onIncrease={() =>
              updateSetting('layerHeight', Math.min(0.32, +(settings.layerHeight + 0.04).toFixed(2)))
            }
          />
          <SettingRow
            label="Infill"
            value={settings.infillDensity}
            unit="%"
            onDecrease={() =>
              updateSetting('infillDensity', Math.max(0, settings.infillDensity - 5))
            }
            onIncrease={() =>
              updateSetting('infillDensity', Math.min(100, settings.infillDensity + 5))
            }
          />
          <SettingRow
            label="Walls"
            value={settings.wallCount}
            onDecrease={() =>
              updateSetting('wallCount', Math.max(1, settings.wallCount - 1))
            }
            onIncrease={() =>
              updateSetting('wallCount', Math.min(10, settings.wallCount + 1))
            }
          />
          <SettingRow
            label="Print Speed"
            value={settings.printSpeed}
            unit="mm/s"
            onDecrease={() =>
              updateSetting('printSpeed', Math.max(50, settings.printSpeed - 25))
            }
            onIncrease={() =>
              updateSetting('printSpeed', Math.min(500, settings.printSpeed + 25))
            }
          />

          {/* Supports Toggle */}
          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>Supports</Text>
            <Switch
              value={settings.supportEnabled}
              onValueChange={(v) => updateSetting('supportEnabled', v)}
              trackColor={{ false: COLORS.border, true: COLORS.primaryDim }}
              thumbColor={settings.supportEnabled ? COLORS.primary : COLORS.textMuted}
            />
          </View>
        </View>

        {/* Advanced Toggle */}
        <TouchableOpacity
          style={styles.advancedToggle}
          onPress={() => setShowAdvanced(!showAdvanced)}
        >
          <Text style={styles.advancedToggleText}>Advanced Settings</Text>
          <Ionicons
            name={showAdvanced ? 'chevron-up' : 'chevron-down'}
            size={20}
            color={COLORS.textSecondary}
          />
        </TouchableOpacity>

        {showAdvanced && (
          <View style={styles.settingsCard}>
            <SettingRow
              label="Top Layers"
              value={settings.topLayers}
              onDecrease={() =>
                updateSetting('topLayers', Math.max(1, settings.topLayers - 1))
              }
              onIncrease={() =>
                updateSetting('topLayers', Math.min(10, settings.topLayers + 1))
              }
            />
            <SettingRow
              label="Bottom Layers"
              value={settings.bottomLayers}
              onDecrease={() =>
                updateSetting('bottomLayers', Math.max(1, settings.bottomLayers - 1))
              }
              onIncrease={() =>
                updateSetting('bottomLayers', Math.min(10, settings.bottomLayers + 1))
              }
            />
            <SettingRow
              label="Nozzle Temp"
              value={settings.temperature}
              unit="°C"
              onDecrease={() =>
                updateSetting('temperature', Math.max(170, settings.temperature - 5))
              }
              onIncrease={() =>
                updateSetting('temperature', Math.min(300, settings.temperature + 5))
              }
            />
            <SettingRow
              label="Bed Temp"
              value={settings.bedTemperature}
              unit="°C"
              onDecrease={() =>
                updateSetting('bedTemperature', Math.max(0, settings.bedTemperature - 5))
              }
              onIncrease={() =>
                updateSetting('bedTemperature', Math.min(120, settings.bedTemperature + 5))
              }
            />
            <SettingRow
              label="Fan Speed"
              value={settings.fanSpeed}
              unit="%"
              onDecrease={() =>
                updateSetting('fanSpeed', Math.max(0, settings.fanSpeed - 10))
              }
              onIncrease={() =>
                updateSetting('fanSpeed', Math.min(100, settings.fanSpeed + 10))
              }
            />

            {/* Infill Pattern */}
            <View style={styles.settingRow}>
              <Text style={styles.settingLabel}>Infill Pattern</Text>
              <TouchableOpacity
                style={styles.patternBtn}
                onPress={() => {
                  const patterns: SliceSettings['infillPattern'][] = [
                    'grid', 'gyroid', 'honeycomb', 'lines', 'triangles',
                  ];
                  const idx = patterns.indexOf(settings.infillPattern);
                  updateSetting('infillPattern', patterns[(idx + 1) % patterns.length]);
                }}
              >
                <Text style={styles.patternText}>
                  {settings.infillPattern.charAt(0).toUpperCase() + settings.infillPattern.slice(1)}
                </Text>
              </TouchableOpacity>
            </View>

            {/* Adhesion Type */}
            <View style={styles.settingRow}>
              <Text style={styles.settingLabel}>Adhesion</Text>
              <TouchableOpacity
                style={styles.patternBtn}
                onPress={() => {
                  const types: SliceSettings['adhesionType'][] = [
                    'none', 'skirt', 'brim', 'raft',
                  ];
                  const idx = types.indexOf(settings.adhesionType);
                  updateSetting('adhesionType', types[(idx + 1) % types.length]);
                }}
              >
                <Text style={styles.patternText}>
                  {settings.adhesionType.charAt(0).toUpperCase() + settings.adhesionType.slice(1)}
                </Text>
              </TouchableOpacity>
            </View>

            {settings.supportEnabled && (
              <View style={styles.settingRow}>
                <Text style={styles.settingLabel}>Support Type</Text>
                <TouchableOpacity
                  style={styles.patternBtn}
                  onPress={() =>
                    updateSetting(
                      'supportType',
                      settings.supportType === 'normal' ? 'tree' : 'normal',
                    )
                  }
                >
                  <Text style={styles.patternText}>
                    {settings.supportType === 'normal' ? 'Normal' : 'Tree'}
                  </Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}

        <View style={{ height: 120 }} />
      </ScrollView>

      {/* Slice Button */}
      <View style={styles.bottomBar}>
        <TouchableOpacity
          style={[styles.sliceBtn, slicing && { opacity: 0.6 }]}
          onPress={handleSlice}
          disabled={slicing}
        >
          {slicing ? (
            <ActivityIndicator color={COLORS.bg} />
          ) : (
            <>
              <Ionicons name="layers" size={22} color={COLORS.bg} />
              <Text style={styles.sliceBtnText}>Slice Model</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.lg,
    paddingTop: 60,
    paddingBottom: SPACING.md,
  },
  headerTitle: { ...FONTS.heading, fontSize: 18 },
  headerSubtitle: { ...FONTS.small, marginTop: 2 },
  content: { paddingHorizontal: SPACING.lg },
  sectionTitle: {
    ...FONTS.body,
    fontWeight: '700',
    marginTop: SPACING.lg,
    marginBottom: SPACING.sm,
  },
  presets: { gap: SPACING.sm },
  presetCard: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  presetCardActive: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primaryDim,
  },
  presetName: { ...FONTS.body, fontWeight: '700' },
  presetDesc: { ...FONTS.small, marginTop: 2 },
  settingsCard: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: SPACING.sm,
  },
  settingLabel: { ...FONTS.body, flex: 1 },
  settingControl: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  settingBtn: {
    width: 32,
    height: 32,
    borderRadius: RADIUS.sm,
    backgroundColor: COLORS.surfaceLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingValue: {
    ...FONTS.body,
    fontWeight: '600',
    minWidth: 70,
    textAlign: 'center',
    color: COLORS.primary,
  },
  advancedToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: SPACING.lg,
    marginBottom: SPACING.sm,
  },
  advancedToggleText: { ...FONTS.body, fontWeight: '700', color: COLORS.textSecondary },
  patternBtn: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    backgroundColor: COLORS.surfaceLight,
    borderRadius: RADIUS.sm,
  },
  patternText: { ...FONTS.body, color: COLORS.primary, fontWeight: '600' },
  bottomBar: {
    position: 'absolute',
    bottom: 30,
    left: SPACING.lg,
    right: SPACING.lg,
  },
  sliceBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.lg,
    paddingVertical: 16,
    gap: SPACING.sm,
  },
  sliceBtnText: { color: COLORS.bg, fontWeight: '800', fontSize: 17 },
});
