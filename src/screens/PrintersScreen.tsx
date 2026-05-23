import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Alert,
  TextInput,
  Modal,
} from 'react-native';
import { useFocusEffect, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS } from '../constants/theme';
import { PrinterConfig } from '../types';
import { getPrinters, getSliceJobs, removePrinter, savePrinter } from '../services/storage';
import {
  getBridgePrinters,
  removeBridgePrinter,
  saveBridgePrinter,
  sendPrint,
  testBridgePrinter,
} from '../services/bambu';

const MODELS: PrinterConfig['model'][] = ['P1S', 'A1Mini', 'A1', 'P1P', 'X1C'];

export default function PrintersScreen() {
  const route = useRoute<any>();
  const gcodeJobId = route.params?.gcodeJobId;

  const [printers, setPrinters] = useState<PrinterConfig[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [newPrinter, setNewPrinter] = useState({
    name: '',
    ip: '',
    accessCode: '',
    serialNumber: '',
    model: 'P1S' as PrinterConfig['model'],
  });

  useFocusEffect(
    useCallback(() => {
      loadPrinters();
    }, []),
  );

  async function loadPrinters() {
    setSyncing(true);
    try {
      const remotePrinters = await getBridgePrinters();
      setPrinters(remotePrinters);
      for (const printer of remotePrinters) {
        await savePrinter(printer);
      }
    } catch {
      const cachedPrinters = await getPrinters();
      setPrinters(cachedPrinters);
    } finally {
      setSyncing(false);
    }
  }

  async function addPrinter() {
    if (!newPrinter.name || !newPrinter.ip || !newPrinter.serialNumber || !newPrinter.accessCode) {
      Alert.alert('Missing Info', 'Please fill in name, IP, serial number, and LAN access code.');
      return;
    }

    try {
      const printer = await saveBridgePrinter({
        name: newPrinter.name.trim(),
        ip: newPrinter.ip.trim(),
        serialNumber: newPrinter.serialNumber.trim(),
        accessCode: newPrinter.accessCode.trim(),
        model: newPrinter.model,
      });

      await savePrinter(printer);
      await loadPrinters();
      setShowAdd(false);
      setNewPrinter({ name: '', ip: '', accessCode: '', serialNumber: '', model: 'P1S' });
    } catch (err: any) {
      Alert.alert('Add Printer Failed', err.message);
    }
  }

  async function deletePrinter(printer: PrinterConfig) {
    Alert.alert('Remove Printer', `Remove "${printer.name}" from the bridge?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await removeBridgePrinter(printer.id);
          } catch {}
          await removePrinter(printer.id);
          setPrinters((current) => current.filter((p) => p.id !== printer.id));
        },
      },
    ]);
  }

  async function testPrinter(printer: PrinterConfig) {
    try {
      await testBridgePrinter(printer.id);
      Alert.alert('Printer Reached', `${printer.name} answered through the bridge.`);
    } catch (err: any) {
      Alert.alert('Printer Test Failed', err.message);
    }
  }

  async function sendToPrinter(printer: PrinterConfig) {
    if (!gcodeJobId) {
      Alert.alert('No G-code', 'Slice a model first, then send it to a printer.');
      return;
    }

    try {
      const jobs = await getSliceJobs();
      const job = jobs.find((j) => j.id === gcodeJobId);
      if (!job?.serverJobId) {
        Alert.alert('Error', 'Bridge slice job not found. Re-slice the model and try again.');
        return;
      }

      Alert.alert(
        'Send to Printer',
        `Send "${job.modelName}" to ${printer.name}?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Send',
            onPress: async () => {
              try {
                await sendPrint(printer, job);
                Alert.alert('Sent!', `Print job sent to ${printer.name}.`);
              } catch (err: any) {
                Alert.alert('Send Failed', err.message);
              }
            },
          },
        ],
      );
    } catch (err: any) {
      Alert.alert('Error', err.message);
    }
  }

  function renderPrinter({ item }: { item: PrinterConfig }) {
    return (
      <TouchableOpacity
        style={styles.printerCard}
        onPress={() => (gcodeJobId ? sendToPrinter(item) : testPrinter(item))}
        onLongPress={() => deletePrinter(item)}
      >
        <View style={styles.printerIcon}>
          <Ionicons name="print" size={28} color={COLORS.secondary} />
        </View>
        <View style={styles.printerInfo}>
          <Text style={styles.printerName}>{item.name}</Text>
          <Text style={styles.printerMeta}>
            {item.model === 'A1Mini' ? 'A1 mini' : item.model} · {item.ip} · bridge
          </Text>
        </View>
        <View style={styles.testIcon}>
          <Ionicons name="pulse" size={18} color={COLORS.textMuted} />
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Printers</Text>
        <Text style={styles.subtitle}>
          {syncing
            ? 'Syncing with bridge...'
            : gcodeJobId
              ? 'Select a printer to send G-code'
              : `${printers.length} configured on bridge`}
        </Text>
      </View>

      {gcodeJobId && (
        <View style={styles.banner}>
          <Ionicons name="information-circle" size={18} color={COLORS.primary} />
          <Text style={styles.bannerText}>Tap a printer to send through your Mac or Ubuntu bridge</Text>
        </View>
      )}

      {printers.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="print-outline" size={64} color={COLORS.textMuted} />
          <Text style={styles.emptyTitle}>No printers</Text>
          <Text style={styles.emptyText}>
            Add your Bambu printer to the bridge to start printing
          </Text>
        </View>
      ) : (
        <FlatList
          data={printers}
          keyExtractor={(item) => item.id}
          renderItem={renderPrinter}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
        />
      )}

      <View style={styles.bottomBar}>
        <TouchableOpacity style={styles.addBtn} onPress={() => setShowAdd(true)}>
          <Ionicons name="add" size={22} color={COLORS.bg} />
          <Text style={styles.addBtnText}>Add Printer</Text>
        </TouchableOpacity>
      </View>

      <Modal visible={showAdd} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>Add Printer</Text>
            <Text style={styles.modalSubtitle}>
              Credentials stay on the bridge. Find the LAN access code in the printer network settings.
            </Text>

            <TextInput
              style={styles.input}
              placeholder="Printer Name (e.g., Workshop P1S)"
              placeholderTextColor={COLORS.textMuted}
              value={newPrinter.name}
              onChangeText={(t) => setNewPrinter((p) => ({ ...p, name: t }))}
            />
            <TextInput
              style={styles.input}
              placeholder="Printer IP (e.g., 192.168.1.100)"
              placeholderTextColor={COLORS.textMuted}
              value={newPrinter.ip}
              onChangeText={(t) => setNewPrinter((p) => ({ ...p, ip: t }))}
              keyboardType="numbers-and-punctuation"
              autoCapitalize="none"
            />
            <TextInput
              style={styles.input}
              placeholder="Serial Number"
              placeholderTextColor={COLORS.textMuted}
              value={newPrinter.serialNumber}
              onChangeText={(t) => setNewPrinter((p) => ({ ...p, serialNumber: t }))}
              autoCapitalize="none"
            />
            <TextInput
              style={styles.input}
              placeholder="LAN Access Code"
              placeholderTextColor={COLORS.textMuted}
              value={newPrinter.accessCode}
              onChangeText={(t) => setNewPrinter((p) => ({ ...p, accessCode: t }))}
              autoCapitalize="none"
              secureTextEntry
            />

            <View style={styles.modelPicker}>
              {MODELS.map((model) => (
                <TouchableOpacity
                  key={model}
                  style={[
                    styles.modelChip,
                    newPrinter.model === model && styles.modelChipActive,
                  ]}
                  onPress={() => setNewPrinter((p) => ({ ...p, model }))}
                >
                  <Text
                    style={[
                      styles.modelChipText,
                      newPrinter.model === model && { color: COLORS.bg },
                    ]}
                  >
                    {model === 'A1Mini' ? 'A1 mini' : model}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancel}
                onPress={() => {
                  setShowAdd(false);
                  setNewPrinter({ name: '', ip: '', accessCode: '', serialNumber: '', model: 'P1S' });
                }}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalConfirm} onPress={addPrinter}>
                <Text style={styles.modalConfirmText}>Add</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  header: { paddingHorizontal: SPACING.lg, paddingTop: 60, paddingBottom: SPACING.md },
  title: { ...FONTS.title },
  subtitle: { ...FONTS.small, marginTop: SPACING.xs },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.primaryDim,
    marginHorizontal: SPACING.lg,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    gap: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  bannerText: { ...FONTS.small, color: COLORS.primary, flex: 1 },
  list: { paddingHorizontal: SPACING.lg, paddingBottom: 120 },
  printerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  printerIcon: {
    width: 48,
    height: 48,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.secondaryDim,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: SPACING.md,
  },
  printerInfo: { flex: 1 },
  printerName: { ...FONTS.body, fontWeight: '600' },
  printerMeta: { ...FONTS.small, marginTop: 2 },
  testIcon: {
    width: 36,
    height: 36,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.surfaceLight,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 100,
  },
  emptyTitle: { ...FONTS.heading, fontSize: 20, marginTop: SPACING.md },
  emptyText: { ...FONTS.small, marginTop: SPACING.xs, textAlign: 'center' },
  bottomBar: {
    position: 'absolute',
    bottom: 30,
    left: SPACING.lg,
    right: SPACING.lg,
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.secondary,
    borderRadius: RADIUS.lg,
    paddingVertical: 14,
    gap: SPACING.sm,
  },
  addBtnText: { fontWeight: '700', fontSize: 15, color: COLORS.bg },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    paddingHorizontal: SPACING.lg,
  },
  modal: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.xl,
    padding: SPACING.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  modalTitle: { ...FONTS.heading, fontSize: 20 },
  modalSubtitle: { ...FONTS.small, marginTop: SPACING.xs, marginBottom: SPACING.md },
  input: {
    backgroundColor: COLORS.bg,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    color: COLORS.text,
    fontSize: 15,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: SPACING.sm,
  },
  modelPicker: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
    marginTop: SPACING.xs,
  },
  modelChip: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.bg,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  modelChipActive: {
    backgroundColor: COLORS.secondary,
    borderColor: COLORS.secondary,
  },
  modelChipText: {
    ...FONTS.small,
    fontWeight: '700',
  },
  modalActions: {
    flexDirection: 'row',
    marginTop: SPACING.md,
    gap: SPACING.sm,
  },
  modalCancel: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.surfaceLight,
  },
  modalCancelText: { color: COLORS.textSecondary, fontWeight: '600' },
  modalConfirm: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.secondary,
  },
  modalConfirmText: { color: COLORS.bg, fontWeight: '700' },
});
