import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS } from '../constants/theme';
import { getSliceServerUrl, setSliceServerUrl } from '../services/storage';

type ServerMode = 'tailscale' | 'local' | 'cloud' | 'custom';

const LOCAL_URL = 'http://localhost:4000';

export default function SettingsScreen() {
  const [serverUrl, setServerUrl] = useState('');
  const [savedUrl, setSavedUrl] = useState('');
  const [serverMode, setServerMode] = useState<ServerMode>('tailscale');
  const [tailscaleIp, setTailscaleIp] = useState('');
  const [testing, setTesting] = useState(false);
  const [serverStatus, setServerStatus] = useState<'unknown' | 'online' | 'offline'>('unknown');

  useEffect(() => {
    loadSettings();
  }, []);

  async function loadSettings() {
    const url = await getSliceServerUrl();
    setServerUrl(url);
    setSavedUrl(url);

    // Detect current mode from saved URL
    if (!url || url === LOCAL_URL) {
      setServerMode('local');
    } else if (url.match(/^https?:\/\/100\./)) {
      setServerMode('tailscale');
      // Extract IP from URL
      const match = url.match(/\/\/([\d.]+)/);
      if (match) setTailscaleIp(match[1]);
    } else {
      setServerMode('custom');
    }

    if (url) testUrl(url);
  }

  async function selectMode(mode: ServerMode) {
    setServerMode(mode);
    if (mode === 'local') {
      setServerUrl(LOCAL_URL);
      await setSliceServerUrl(LOCAL_URL);
      setSavedUrl(LOCAL_URL);
      testUrl(LOCAL_URL);
    }
    // For tailscale and custom, user needs to enter IP/URL and save
  }

  async function saveTailscaleIp() {
    const ip = tailscaleIp.trim();
    if (!ip) return;
    const url = `http://${ip}:4000`;
    setServerUrl(url);
    await setSliceServerUrl(url);
    setSavedUrl(url);
    testUrl(url);
  }

  async function testUrl(url: string) {
    setTesting(true);
    setServerStatus('unknown');
    try {
      const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(5000) });
      setServerStatus(response.ok ? 'online' : 'offline');
    } catch {
      setServerStatus('offline');
    }
    setTesting(false);
  }

  async function saveCustomUrl() {
    let url = serverUrl.trim();
    if (url.endsWith('/')) url = url.slice(0, -1);
    setServerUrl(url);
    await setSliceServerUrl(url);
    setSavedUrl(url);
    testUrl(url);
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Settings</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Server Mode */}
        <Text style={styles.sectionTitle}>Slicer Server</Text>

        {/* Status indicator */}
        <View style={styles.statusBar}>
          {testing ? (
            <ActivityIndicator size="small" color={COLORS.primary} />
          ) : (
            <View style={[styles.statusDot, {
              backgroundColor: serverStatus === 'online' ? '#34C759' :
                             serverStatus === 'offline' ? '#FF3B30' : COLORS.textMuted
            }]} />
          )}
          <Text style={styles.statusText}>
            {testing ? 'Testing connection...' :
             serverStatus === 'online' ? 'Server connected' :
             serverStatus === 'offline' ? 'Server unreachable' :
             'Auto-detect on slice'}
          </Text>
        </View>

        {/* Mode cards */}
        <View style={styles.modesContainer}>
          <ModeCard
            icon="globe"
            title="Tailscale"
            desc="Works from anywhere"
            selected={serverMode === 'tailscale'}
            onPress={() => selectMode('tailscale')}
          />
          <ModeCard
            icon="desktop"
            title="Local"
            desc="Same WiFi only"
            selected={serverMode === 'local'}
            onPress={() => selectMode('local')}
          />
          <ModeCard
            icon="create"
            title="Custom URL"
            desc="Cloud or other server"
            selected={serverMode === 'custom'}
            onPress={() => selectMode('custom')}
          />
        </View>

        {/* Tailscale IP input */}
        {serverMode === 'tailscale' && (
          <View style={styles.card}>
            <Text style={styles.cardDescription}>
              Enter your server's Tailscale IP. You can find it by running
              {' '}<Text style={{ fontFamily: 'Courier', color: COLORS.primary }}>tailscale ip -4</Text>{' '}
              on the machine running BambuSlicer Server.
            </Text>
            <TextInput
              style={styles.input}
              placeholder="100.x.x.x"
              placeholderTextColor={COLORS.textMuted}
              value={tailscaleIp}
              onChangeText={setTailscaleIp}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="decimal-pad"
            />
            <View style={styles.cardActions}>
              <TouchableOpacity style={styles.testBtn} onPress={() => testUrl(`http://${tailscaleIp.trim()}:4000`)}>
                <Ionicons name="pulse" size={18} color={COLORS.secondary} />
                <Text style={styles.testBtnText}>Test</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.saveBtn, !tailscaleIp.trim() && { opacity: 0.5 }]}
                onPress={saveTailscaleIp}
                disabled={!tailscaleIp.trim()}
              >
                <Text style={styles.saveBtnText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Custom URL input */}
        {serverMode === 'custom' && (
          <View style={styles.card}>
            <Text style={styles.cardDescription}>
              Enter the full URL of your slicer server.
            </Text>
            <TextInput
              style={styles.input}
              placeholder="https://your-server.com:4000"
              placeholderTextColor={COLORS.textMuted}
              value={serverUrl}
              onChangeText={setServerUrl}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
            <View style={styles.cardActions}>
              <TouchableOpacity style={styles.testBtn} onPress={() => testUrl(serverUrl)}>
                <Ionicons name="pulse" size={18} color={COLORS.secondary} />
                <Text style={styles.testBtnText}>Test</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.saveBtn, serverUrl === savedUrl && { opacity: 0.5 }]}
                onPress={saveCustomUrl}
                disabled={serverUrl === savedUrl}
              >
                <Text style={styles.saveBtnText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Setup Guide */}
        <Text style={styles.sectionTitle}>Setup</Text>
        <View style={styles.card}>
          <Text style={styles.stepTitle}>1. Install the server (one command)</Text>
          <View style={styles.codeBlock}>
            <Text style={styles.codeText} selectable>
              curl -fsSL https://raw.githubusercontent.com/ammarjmahmood/islicer/main/server/install.sh | bash
            </Text>
          </View>
          <Text style={styles.cardDescription}>
            Runs on any Mac, Linux, Jetson, or Raspberry Pi. Installs Node.js, CuraEngine, and sets up as a background service.
          </Text>

          <Text style={[styles.stepTitle, { marginTop: SPACING.md }]}>
            2. Install Tailscale (free)
          </Text>
          <Text style={styles.cardDescription}>
            Install on your server + phone from tailscale.com.{'\n'}
            Then run: <Text style={{ fontFamily: 'Courier', color: COLORS.primary }}>tailscale ip -4</Text> to get the IP.
          </Text>

          <Text style={[styles.stepTitle, { marginTop: SPACING.md }]}>3. Enter the IP above</Text>
          <Text style={styles.cardDescription}>
            Paste the Tailscale IP into the field above. Done — slice from anywhere.
          </Text>
        </View>

        {/* Bambu Cloud Printing */}
        <Text style={styles.sectionTitle}>Printer Connection</Text>
        <View style={styles.card}>
          <Text style={styles.cardDescription}>
            Prints are sent to your Bambu printer via Bambu Cloud — no need to
            be on the same network as the printer. Just log in with your Bambu
            Lab account in the Printers tab.
          </Text>
        </View>

        {/* About */}
        <Text style={styles.sectionTitle}>About</Text>
        <View style={styles.card}>
          <View style={styles.aboutRow}>
            <Text style={styles.aboutLabel}>Version</Text>
            <Text style={styles.aboutValue}>2.0.0</Text>
          </View>
          <View style={styles.aboutRow}>
            <Text style={styles.aboutLabel}>Supported Printers</Text>
            <Text style={styles.aboutValue}>Bambu Lab P1S, P1P, X1C, A1</Text>
          </View>
          <View style={styles.aboutRow}>
            <Text style={styles.aboutLabel}>Supported Files</Text>
            <Text style={styles.aboutValue}>STL, 3MF</Text>
          </View>
        </View>

        <View style={{ height: 80 }} />
      </ScrollView>
    </View>
  );
}

// MARK: - Mode Card Component

function ModeCard({
  icon,
  title,
  desc,
  selected,
  onPress,
}: {
  icon: string;
  title: string;
  desc: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.modeCard, selected && styles.modeCardSelected]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Ionicons
        name={icon as any}
        size={22}
        color={selected ? COLORS.primary : COLORS.textMuted}
      />
      <Text style={[styles.modeTitle, selected && { color: COLORS.primary }]}>
        {title}
      </Text>
      <Text style={styles.modeDesc}>{desc}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  header: { paddingHorizontal: SPACING.lg, paddingTop: 60, paddingBottom: SPACING.md },
  title: { ...FONTS.title },
  content: { paddingHorizontal: SPACING.lg },
  sectionTitle: {
    ...FONTS.body,
    fontWeight: '700',
    marginTop: SPACING.lg,
    marginBottom: SPACING.sm,
  },
  statusBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    marginBottom: SPACING.md,
    paddingHorizontal: SPACING.sm,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusText: {
    ...FONTS.small,
    color: COLORS.textMuted,
  },
  modesContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
    marginBottom: SPACING.md,
  },
  modeCard: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    gap: 4,
  },
  modeCardSelected: {
    borderColor: COLORS.primary,
    backgroundColor: `${COLORS.primary}15`,
  },
  modeTitle: {
    ...FONTS.body,
    fontWeight: '600',
    fontSize: 13,
  },
  modeDesc: {
    ...FONTS.small,
    fontSize: 11,
    textAlign: 'center',
    color: COLORS.textMuted,
  },
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  cardDescription: { ...FONTS.small, lineHeight: 18, marginBottom: SPACING.sm },
  stepTitle: {
    ...FONTS.body,
    fontWeight: '600',
    fontSize: 14,
    marginBottom: 4,
  },
  input: {
    backgroundColor: COLORS.bg,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    color: COLORS.text,
    fontSize: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  cardActions: {
    flexDirection: 'row',
    marginTop: SPACING.sm,
    gap: SPACING.sm,
  },
  testBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.secondaryDim,
    gap: SPACING.xs,
  },
  testBtnText: { color: COLORS.secondary, fontWeight: '600', fontSize: 14 },
  saveBtn: {
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.primary,
  },
  saveBtnText: { color: COLORS.bg, fontWeight: '700', fontSize: 14 },
  aboutRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  codeBlock: {
    backgroundColor: COLORS.bg,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  codeText: {
    fontFamily: 'Courier',
    fontSize: 11,
    color: COLORS.primary,
  },
  aboutLabel: { ...FONTS.body },
  aboutValue: { ...FONTS.small, color: COLORS.primary },
});
