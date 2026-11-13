import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, RADIUS, SPACING } from '../constants/theme';
import { PrinterConfig } from '../types';
import { addBridgePrinter, testBridgePrinter } from '../services/bambu';

const MODELS: { id: PrinterConfig['model']; label: string }[] = [
  { id: 'P1S', label: 'P1S' },
  { id: 'P1P', label: 'P1P' },
  { id: 'X1C', label: 'X1C' },
  { id: 'X1', label: 'X1' },
  { id: 'A1', label: 'A1' },
  { id: 'A1Mini', label: 'A1 mini' },
];

/** Where each value lives on the printer's own screen, by family. */
function whereToLook(model: PrinterConfig['model']) {
  if (model === 'X1C' || model === 'X1') {
    return {
      network: 'On the printer touchscreen: Settings (gear) → Network. It shows the IP address and the Access Code.',
      serial: 'Settings → General → Device info. It is 15 characters and starts with 00M.',
    };
  }
  if (model === 'A1' || model === 'A1Mini') {
    return {
      network: 'On the printer touchscreen: Settings → LAN Only Mode (or WLAN). It shows the IP address and the Access Code.',
      serial: 'Settings → Device. It is 15 characters and starts with 030 (A1 mini) or 039 (A1).',
    };
  }
  return {
    network: 'On the printer screen: Settings (gear) → WLAN. It shows the IP address and the Access Code.',
    serial: 'Settings → Device. It is 15 characters and starts with 01S (P1P) or 01P (P1S).',
  };
}

export default function AddPrinterScreen() {
  const navigation = useNavigation<any>();
  const [model, setModel] = useState<PrinterConfig['model']>('P1S');
  const [name, setName] = useState('');
  const [ip, setIp] = useState('');
  const [serial, setSerial] = useState('');
  const [accessCode, setAccessCode] = useState('');
  const [saving, setSaving] = useState(false);
  const help = whereToLook(model);

  const ready = /^\d{1,3}(\.\d{1,3}){3}$/.test(ip.trim()) && serial.trim().length >= 10 && accessCode.trim().length >= 6;

  async function save() {
    setSaving(true);
    try {
      const printer = await addBridgePrinter({
        name: name.trim() || `My ${MODELS.find((m) => m.id === model)?.label}`,
        model,
        ip: ip.trim(),
        serialNumber: serial.trim().toUpperCase(),
        accessCode: accessCode.trim(),
      });
      try {
        await testBridgePrinter(printer.id);
        Alert.alert('Printer added', 'Your computer reached the printer. You are ready to print.', [
          { text: 'Done', onPress: () => navigation.goBack() },
        ]);
      } catch (err: any) {
        Alert.alert(
          'Saved, but the printer did not answer',
          `${err.message}\n\nCheck the IP address and Access Code. On newer firmware, also turn on LAN Only Mode and Developer Mode on the printer (Settings → LAN Only Mode).`,
          [{ text: 'OK', onPress: () => navigation.goBack() }],
        );
      }
    } catch (err: any) {
      Alert.alert('Could not save', err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={12}>
          <Ionicons name="arrow-back" size={24} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Add your Bambu printer</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.lead}>
          You need three things from the printer. Stand next to it; this takes about a minute.
        </Text>

        <Text style={styles.label}>Which printer?</Text>
        <View style={styles.chips}>
          {MODELS.map((item) => (
            <TouchableOpacity
              key={item.id}
              style={[styles.chip, model === item.id && styles.chipOn]}
              onPress={() => setModel(item.id)}
            >
              <Text style={[styles.chipText, model === item.id && { color: '#fff' }]}>{item.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Step number={1} title="IP address" help={help.network}>
          <TextInput
            style={styles.input}
            placeholder="192.168.1.100"
            placeholderTextColor={COLORS.textMuted}
            keyboardType="numbers-and-punctuation"
            autoCorrect={false}
            value={ip}
            onChangeText={setIp}
          />
        </Step>

        <Step number={2} title="Access Code" help="Same screen as the IP address. It is 8 letters and numbers.">
          <TextInput
            style={styles.input}
            placeholder="8 characters"
            placeholderTextColor={COLORS.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            value={accessCode}
            onChangeText={setAccessCode}
          />
        </Step>

        <Step number={3} title="Serial number" help={`${help.serial} It is also in the Bambu Handy app under your printer's settings.`}>
          <TextInput
            style={styles.input}
            placeholder="15 characters"
            placeholderTextColor={COLORS.textMuted}
            autoCapitalize="characters"
            autoCorrect={false}
            value={serial}
            onChangeText={setSerial}
          />
        </Step>

        <Text style={styles.label}>Name (optional)</Text>
        <TextInput
          style={styles.input}
          placeholder="Workshop P1S"
          placeholderTextColor={COLORS.textMuted}
          value={name}
          onChangeText={setName}
        />

        <View style={styles.note}>
          <Ionicons name="lock-closed" size={16} color={COLORS.primary} />
          <Text style={styles.noteText}>
            These are saved on your home computer, not on this phone. The printer and that computer must be on the same home network.
          </Text>
        </View>
        <View style={styles.note}>
          <Ionicons name="alert-circle" size={16} color={COLORS.warning} />
          <Text style={styles.noteText}>
            Newer Bambu firmware only accepts prints from apps like this with LAN Only Mode and Developer Mode turned on (printer Settings → LAN Only Mode). Bambu Handy and cloud printing stop working while LAN Only Mode is on.
          </Text>
        </View>

        <TouchableOpacity style={[styles.save, (!ready || saving) && { opacity: 0.45 }]} disabled={!ready || saving} onPress={save}>
          {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveText}>Save and test</Text>}
        </TouchableOpacity>
        <View style={{ height: 60 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Step({ number, title, help, children }: { number: number; title: string; help: string; children: React.ReactNode }) {
  return (
    <View style={styles.step}>
      <View style={styles.stepHead}>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{number}</Text>
        </View>
        <Text style={styles.stepTitle}>{title}</Text>
      </View>
      <Text style={styles.help}>{help}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, paddingHorizontal: SPACING.lg, paddingTop: 60, paddingBottom: SPACING.md },
  title: { ...FONTS.heading, fontSize: 22 },
  content: { paddingHorizontal: SPACING.lg },
  lead: { ...FONTS.body, color: COLORS.textSecondary, marginBottom: SPACING.md },
  label: { ...FONTS.body, fontWeight: '700', marginTop: SPACING.md, marginBottom: SPACING.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, backgroundColor: COLORS.surface },
  chipOn: { backgroundColor: COLORS.primary },
  chipText: { color: COLORS.text, fontWeight: '600', fontSize: 14 },
  step: { backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, padding: SPACING.md, marginTop: SPACING.md, gap: SPACING.sm },
  stepHead: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  badge: { width: 26, height: 26, borderRadius: 13, backgroundColor: COLORS.primaryDim, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: COLORS.primary, fontWeight: '800' },
  stepTitle: { ...FONTS.body, fontWeight: '700' },
  help: { ...FONTS.small, color: COLORS.textSecondary, lineHeight: 19 },
  input: { backgroundColor: COLORS.bg, borderRadius: RADIUS.md, paddingHorizontal: SPACING.md, paddingVertical: 12, color: COLORS.text, fontSize: 16, borderWidth: 1, borderColor: COLORS.border },
  note: { flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.md, alignItems: 'flex-start' },
  noteText: { ...FONTS.small, color: COLORS.textSecondary, flex: 1, lineHeight: 19 },
  save: { backgroundColor: COLORS.primary, borderRadius: RADIUS.md, paddingVertical: 16, alignItems: 'center', marginTop: SPACING.lg },
  saveText: { color: '#fff', fontSize: 17, fontWeight: '700' },
});
