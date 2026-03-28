import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS } from '../constants/theme';
import { SliceJob } from '../types';
import { getSliceJobs } from '../services/storage';

export default function SliceProgressScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const jobId = route.params?.jobId;

  const [job, setJob] = useState<SliceJob | null>(null);

  useEffect(() => {
    loadJob();
    const interval = setInterval(loadJob, 2000);
    return () => clearInterval(interval);
  }, []);

  async function loadJob() {
    const jobs = await getSliceJobs();
    const j = jobs.find((x) => x.id === jobId);
    setJob(j || null);
  }

  function formatTime(seconds?: number): string {
    if (!seconds) return '--';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  }

  function formatFilament(grams?: number): string {
    if (!grams) return '--';
    return `${grams.toFixed(1)}g`;
  }

  function getStatusIcon() {
    if (!job) return 'hourglass-outline';
    switch (job.status) {
      case 'queued': return 'time-outline';
      case 'slicing': return 'layers-outline';
      case 'done': return 'checkmark-circle';
      case 'error': return 'alert-circle';
    }
  }

  function getStatusColor() {
    if (!job) return COLORS.textMuted;
    switch (job.status) {
      case 'queued': return COLORS.warning;
      case 'slicing': return COLORS.primary;
      case 'done': return COLORS.success;
      case 'error': return COLORS.error;
    }
  }

  function getStatusText() {
    if (!job) return 'Loading...';
    switch (job.status) {
      case 'queued': return 'Queued';
      case 'slicing': return 'Slicing...';
      case 'done': return 'Ready to Print';
      case 'error': return 'Failed';
    }
  }

  function handleSendToPrinter() {
    navigation.navigate('Main', { screen: 'Printers', params: { gcodeJobId: jobId } });
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={24} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Slice Progress</Text>
        <View style={{ width: 24 }} />
      </View>

      <View style={styles.center}>
        {/* Status Circle */}
        <View style={[styles.statusCircle, { borderColor: getStatusColor() }]}>
          {job?.status === 'slicing' ? (
            <ActivityIndicator size="large" color={COLORS.primary} />
          ) : (
            <Ionicons name={getStatusIcon() as any} size={48} color={getStatusColor()} />
          )}
        </View>

        <Text style={[styles.statusText, { color: getStatusColor() }]}>
          {getStatusText()}
        </Text>

        {job && (
          <Text style={styles.modelName}>{job.modelName}</Text>
        )}

        {job?.status === 'slicing' && (
          <View style={styles.progressBar}>
            <View
              style={[styles.progressFill, { width: `${job.progress}%` }]}
            />
          </View>
        )}

        {job?.status === 'done' && (
          <View style={styles.stats}>
            <View style={styles.stat}>
              <Ionicons name="time-outline" size={20} color={COLORS.textSecondary} />
              <Text style={styles.statLabel}>Est. Time</Text>
              <Text style={styles.statValue}>{formatTime(job.estimatedTime)}</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.stat}>
              <Ionicons name="color-fill-outline" size={20} color={COLORS.textSecondary} />
              <Text style={styles.statLabel}>Filament</Text>
              <Text style={styles.statValue}>{formatFilament(job.estimatedFilament)}</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.stat}>
              <Ionicons name="layers-outline" size={20} color={COLORS.textSecondary} />
              <Text style={styles.statLabel}>Preset</Text>
              <Text style={styles.statValue}>{job.presetName}</Text>
            </View>
          </View>
        )}

        {job?.status === 'error' && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{job.error}</Text>
          </View>
        )}
      </View>

      {job?.status === 'done' && (
        <View style={styles.bottomBar}>
          <TouchableOpacity style={styles.printBtn} onPress={handleSendToPrinter}>
            <Ionicons name="print" size={22} color={COLORS.bg} />
            <Text style={styles.printBtnText}>Send to Printer</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg,
    paddingTop: 60,
    paddingBottom: SPACING.md,
  },
  headerTitle: { ...FONTS.heading, fontSize: 18 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.xl,
    paddingBottom: 80,
  },
  statusCircle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.surface,
  },
  statusText: {
    ...FONTS.heading,
    marginTop: SPACING.lg,
  },
  modelName: {
    ...FONTS.small,
    marginTop: SPACING.xs,
  },
  progressBar: {
    width: '100%',
    height: 6,
    backgroundColor: COLORS.surface,
    borderRadius: 3,
    marginTop: SPACING.xl,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: COLORS.primary,
    borderRadius: 3,
  },
  stats: {
    flexDirection: 'row',
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
    marginTop: SPACING.xl,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  stat: { flex: 1, alignItems: 'center', gap: SPACING.xs },
  statLabel: { ...FONTS.small, fontSize: 11 },
  statValue: { ...FONTS.body, fontWeight: '700', color: COLORS.primary },
  statDivider: { width: 1, backgroundColor: COLORS.border },
  errorBox: {
    backgroundColor: COLORS.accentDim,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    marginTop: SPACING.lg,
    width: '100%',
  },
  errorText: { color: COLORS.error, textAlign: 'center' },
  bottomBar: {
    position: 'absolute',
    bottom: 30,
    left: SPACING.lg,
    right: SPACING.lg,
  },
  printBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.lg,
    paddingVertical: 16,
    gap: SPACING.sm,
  },
  printBtnText: { color: COLORS.bg, fontWeight: '800', fontSize: 17 },
});
