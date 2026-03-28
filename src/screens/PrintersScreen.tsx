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
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS } from '../constants/theme';
import { PrinterConfig } from '../types';
import { getPrinters, savePrinter, removePrinter } from '../services/storage';
import { getSliceJobs } from '../services/storage';
import { sendPrintDirect } from '../services/bambu';

export default function PrintersScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const gcodeJobId = route.params?.gcodeJobId;

  const [printers, setPrinters] = useState<PrinterConfig[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [newPrinter, setNewPrinter] = useState({
    name: '',
    ip: '',
    accessCode: '',
    serialNumber: '',
  });

  useFocusEffect(
    useCallback(() => {
      loadPrinters();
    }, [])
  );

  async function loadPrinters() {
    const p = await getPrinters();
    setPrinters(p);
  }

  async function addPrinter() {
    if (!newPrinter.name || !newPrinter.ip || !newPrinter.accessCode) {
      Alert.alert('Missing Info', 'Please fill in name, IP, and access code.');
      return;
    }

    const printer: PrinterConfig = {
      id: `printer_${Date.now()}`,
      name: newPrinter.name,
      ip: newPrinter.ip,
      accessCode: newPrinter.accessCode,
      serialNumber: newPrinter.serialNumber,
      model: 'P1S',
      isOnline: false,
    };

    await savePrinter(printer);
    await loadPrinters();
    setShowAdd(false);
    setNewPrinter({ name: '', ip: '', accessCode: '', serialNumber: '' });
  }

  async function deletePrinter(printer: PrinterConfig) {
    Alert.alert('Remove Printer', `Remove "${printer.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          await removePrinter(printer.id);
          await loadPrinters();
        },
      },
    ]);
  }

  async function sendToPrinter(printer: PrinterConfig) {
    if (!gcodeJobId) {
      Alert.alert('No G-code', 'Slice a model first, then send it to a printer.');
      return;
    }

    try {
      const jobs = await getSliceJobs();
      const job = jobs.find((j) => j.id === gcodeJobId);
      if (!job?.gcodeUri) {
        Alert.alert('Error', 'G-code file not found.');
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
                await sendPrintDirect(printer, job.gcodeUri!, job.modelName);
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
        onPress={() => (gcodeJobId ? sendToPrinter(item) : null)}
        onLongPress={() => deletePrinter(item)}
      >
        <View style={styles.printerIcon}>
          <Ionicons name="print" size={28} color={COLORS.secondary} />
        </View>
        <View style={styles.printerInfo}>
          <Text style={styles.printerName}>{item.name}</Text>
          <Text style={styles.printerMeta}>
            {item.model} · {item.ip}
          </Text>
        </View>
        <View style={[styles.statusDot, { backgroundColor: item.isOnline ? COLORS.success : COLORS.textMuted }]} />
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Printers</Text>
        <Text style={styles.subtitle}>
          {gcodeJobId ? 'Select a printer to send G-code' : `${printers.length} configured`}
        </Text>
      </View>

      {gcodeJobId && (
        <View style={styles.banner}>
          <Ionicons name="information-circle" size={18} color={COLORS.primary} />
          <Text style={styles.bannerText}>Tap a printer to send your sliced model</Text>
        </View>
      )}

      {printers.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="print-outline" size={64} color={COLORS.textMuted} />
          <Text style={styles.emptyTitle}>No printers</Text>
          <Text style={styles.emptyText}>
            Add your Bambu Lab printer to start printing
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
              Find your access code in the printer's network settings
            </Text>

            <TextInput
              style={styles.input}
              placeholder="Printer Name (e.g., My P1S)"
              placeholderTextColor={COLORS.textMuted}
              value={newPrinter.name}
              onChangeText={(t) => setNewPrinter((p) => ({ ...p, name: t }))}
            />
            <TextInput
              style={styles.input}
              placeholder="IP Address (e.g., 192.168.1.100)"
              placeholderTextColor={COLORS.textMuted}
              value={newPrinter.ip}
              onChangeText={(t) => setNewPrinter((p) => ({ ...p, ip: t }))}
              keyboardType="numeric"
            />
            <TextInput
              style={styles.input}
              placeholder="Access Code (8 digits)"
              placeholderTextColor={COLORS.textMuted}
              value={newPrinter.accessCode}
              onChangeText={(t) => setNewPrinter((p) => ({ ...p, accessCode: t }))}
              autoCapitalize="none"
            />
            <TextInput
              style={styles.input}
              placeholder="Serial Number (optional)"
              placeholderTextColor={COLORS.textMuted}
              value={newPrinter.serialNumber}
              onChangeText={(t) => setNewPrinter((p) => ({ ...p, serialNumber: t }))}
              autoCapitalize="none"
            />

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancel}
                onPress={() => {
                  setShowAdd(false);
                  setNewPrinter({ name: '', ip: '', accessCode: '', serialNumber: '' });
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
  bannerText: { ...FONTS.small, color: COLORS.primary },
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
  statusDot: { width: 10, height: 10, borderRadius: 5 },
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
