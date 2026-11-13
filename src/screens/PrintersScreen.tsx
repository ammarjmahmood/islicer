import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS } from '../constants/theme';
import { PrinterConfig } from '../types';
import { getPrinters, getSliceJobs, removePrinter, savePrinter } from '../services/storage';
import {
  getBridgePrinters,
  removeBridgePrinter,
  sendPrint,
  testBridgePrinter,
} from '../services/bambu';
import SetupGuide from '../components/SetupGuide';

export default function PrintersScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const gcodeJobId = route.params?.gcodeJobId;

  const [printers, setPrinters] = useState<PrinterConfig[]>([]);
  const [syncing, setSyncing] = useState(false);

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
            {item.model === 'A1Mini' ? 'A1 mini' : item.model} · configured on bridge
          </Text>
        </View>
        <View style={styles.testIcon}>
          <Ionicons name={gcodeJobId ? 'paper-plane' : 'pulse'} size={18} color={COLORS.textMuted} />
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
              ? 'Select a bridge printer'
              : `${printers.length} available from bridge`}
        </Text>
      </View>

      <View style={styles.infoCard}>
        <Ionicons name="home" size={20} color={COLORS.primary} />
        <Text style={styles.infoText}>
          Printer details are kept on your home computer. This phone only talks to that computer.
        </Text>
      </View>

      {gcodeJobId && (
        <View style={styles.banner}>
          <Ionicons name="information-circle" size={18} color={COLORS.primary} />
          <Text style={styles.bannerText}>Tap a printer to send through the bridge</Text>
        </View>
      )}

      {printers.length === 0 ? (
        <View style={{ paddingHorizontal: SPACING.lg, flex: 1 }}>
          <SetupGuide alwaysShow />
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
        <TouchableOpacity style={styles.secondaryBtn} onPress={loadPrinters}>
          <Ionicons name="refresh" size={20} color={COLORS.secondary} />
          <Text style={styles.secondaryBtnText}>Refresh</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.setupBtn} onPress={() => navigation.navigate('AddPrinter')}>
          <Ionicons name="add" size={20} color={COLORS.bg} />
          <Text style={styles.setupBtnText}>Add Printer</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  header: { paddingHorizontal: SPACING.lg, paddingTop: 60, paddingBottom: SPACING.md },
  title: { ...FONTS.title },
  subtitle: { ...FONTS.small, marginTop: SPACING.xs },
  infoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: SPACING.sm,
  },
  infoText: { ...FONTS.small, color: COLORS.textSecondary, flex: 1 },
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
    paddingHorizontal: SPACING.xl,
  },
  emptyTitle: { ...FONTS.heading, fontSize: 20, marginTop: SPACING.md },
  emptyText: { ...FONTS.small, marginTop: SPACING.xs, textAlign: 'center' },
  bottomBar: {
    position: 'absolute',
    bottom: 30,
    left: SPACING.lg,
    right: SPACING.lg,
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  secondaryBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.lg,
    paddingVertical: 14,
    gap: SPACING.sm,
  },
  secondaryBtnText: { fontWeight: '700', fontSize: 15, color: COLORS.secondary },
  setupBtn: {
    flex: 1.3,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.secondary,
    borderRadius: RADIUS.lg,
    paddingVertical: 14,
    gap: SPACING.sm,
  },
  setupBtnText: { fontWeight: '700', fontSize: 15, color: COLORS.bg },
});
