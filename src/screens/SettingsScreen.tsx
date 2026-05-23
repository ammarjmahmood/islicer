import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS } from '../constants/theme';
import { getSliceServerUrl, setSliceServerUrl } from '../services/storage';

type ServerMode = 'tailscale' | 'local' | 'custom';
type ServerStatus = 'unknown' | 'online' | 'offline';

const DEFAULT_PORT = '8005';

function hostFromUrl(url: string): string {
  const match = url.match(/^https?:\/\/([^:/]+)(?::\d+)?/);
  return match?.[1] || '';
}

function detectMode(url: string): ServerMode {
  if (url.match(/^https?:\/\/100\./)) return 'tailscale';
  if (url.match(/^https?:\/\/(192\.168\.|10\.|172\.(1[6-9]|2\d|3[0-1])\.)/)) return 'local';
  return 'custom';
}

export default function SettingsScreen() {
  const [serverUrl, setServerUrl] = useState('');
  const [serverMode, setServerMode] = useState<ServerMode>('tailscale');
  const [hostInput, setHostInput] = useState('');
  const [customUrl, setCustomUrl] = useState('');
  const [testing, setTesting] = useState(false);
  const [serverStatus, setServerStatus] = useState<ServerStatus>('unknown');
  const [engineText, setEngineText] = useState('Not checked');

  useEffect(() => {
    loadSettings();
  }, []);

  async function loadSettings() {
    const url = await getSliceServerUrl();
    setServerUrl(url);
    if (url) {
      const mode = detectMode(url);
      setServerMode(mode);
      if (mode === 'custom') setCustomUrl(url);
      else setHostInput(hostFromUrl(url));
      testUrl(url);
    }
  }

  async function testUrl(url: string) {
    if (!url) return;
    setTesting(true);
    setServerStatus('unknown');
    try {
      const response = await fetch(`${url.replace(/\/$/, '')}/health`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error('Bridge did not return OK');
      const data = await response.json();
      setServerStatus('online');
      setEngineText(
        data.engine?.available
          ? `${data.engine.name} ready`
          : data.engine?.note || 'Slicer engine not ready',
      );
    } catch {
      setServerStatus('offline');
      setEngineText('Bridge unreachable');
    } finally {
      setTesting(false);
    }
  }

  async function saveBridgeUrl() {
    let url = '';
    if (serverMode === 'custom') {
      url = customUrl.trim();
    } else {
      const host = hostInput.trim();
      if (!host) return;
      url = `http://${host}:${DEFAULT_PORT}`;
    }
    url = url.replace(/\/$/, '');
    setServerUrl(url);
    await setSliceServerUrl(url);
    testUrl(url);
  }

  const modeCopy = {
    tailscale: {
      icon: 'globe',
      title: 'Tailscale',
      desc: 'Anywhere',
      placeholder: '100.x.x.x',
      help: 'Use the Tailscale IP shown by tailscale ip -4 on your Mac or Ubuntu bridge.',
    },
    local: {
      icon: 'wifi',
      title: 'Local Wi-Fi',
      desc: 'Same network',
      placeholder: '192.168.1.50',
      help: 'Use your bridge computer LAN IP, not the printer IP, when your iPhone is on the same Wi-Fi.',
    },
    custom: {
      icon: 'link',
      title: 'Custom',
      desc: 'HTTPS or tunnel',
      placeholder: 'https://bridge.example.com',
      help: 'Use this for a reverse proxy, hosted tunnel, or advanced VPN DNS name.',
    },
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Settings</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.sectionTitle}>Bridge</Text>

        <View style={styles.statusBar}>
          {testing ? (
            <ActivityIndicator size="small" color={COLORS.primary} />
          ) : (
            <View
              style={[
                styles.statusDot,
                {
                  backgroundColor:
                    serverStatus === 'online'
                      ? COLORS.success
                      : serverStatus === 'offline'
                        ? COLORS.error
                        : COLORS.textMuted,
                },
              ]}
            />
          )}
          <View style={{ flex: 1 }}>
            <Text style={styles.statusText}>
              {testing
                ? 'Testing bridge...'
                : serverStatus === 'online'
                  ? 'Bridge connected'
                  : serverStatus === 'offline'
                    ? 'Bridge unreachable'
                    : 'Bridge not checked'}
            </Text>
            <Text style={styles.statusSubtext}>{engineText}</Text>
          </View>
        </View>

        <View style={styles.modesContainer}>
          {(Object.keys(modeCopy) as ServerMode[]).map((mode) => (
            <ModeCard
              key={mode}
              icon={modeCopy[mode].icon}
              title={modeCopy[mode].title}
              desc={modeCopy[mode].desc}
              selected={serverMode === mode}
              onPress={() => setServerMode(mode)}
            />
          ))}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardDescription}>{modeCopy[serverMode].help}</Text>
          <TextInput
            style={styles.input}
            placeholder={modeCopy[serverMode].placeholder}
            placeholderTextColor={COLORS.textMuted}
            value={serverMode === 'custom' ? customUrl : hostInput}
            onChangeText={serverMode === 'custom' ? setCustomUrl : setHostInput}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType={serverMode === 'custom' ? 'url' : 'numbers-and-punctuation'}
          />
          <View style={styles.cardActions}>
            <TouchableOpacity
              style={styles.testBtn}
              onPress={() => testUrl(serverMode === 'custom' ? customUrl : `http://${hostInput}:${DEFAULT_PORT}`)}
            >
              <Ionicons name="pulse" size={18} color={COLORS.secondary} />
              <Text style={styles.testBtnText}>Test</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.saveBtn} onPress={saveBridgeUrl}>
              <Text style={styles.saveBtnText}>Save</Text>
            </TouchableOpacity>
          </View>
          {!!serverUrl && <Text style={styles.savedUrl}>{serverUrl}</Text>}
        </View>

        <Text style={styles.sectionTitle}>Setup</Text>
        <View style={styles.card}>
          <Text style={styles.stepTitle}>1. Install the bridge</Text>
          <View style={styles.codeBlock}>
            <Text style={styles.codeText} selectable>
              curl -fsSL https://raw.githubusercontent.com/ammarjmahmood/islicer/main/server/install.sh | bash
            </Text>
          </View>
          <Text style={styles.cardDescription}>
            Run this on the Mac, Ubuntu box, mini PC, or laptop that stays on near your Bambu printer. If the bridge laptop leaves home, it needs a VPN route back to the printer LAN.
          </Text>

          <Text style={[styles.stepTitle, { marginTop: SPACING.md }]}>2. Connect Tailscale</Text>
          <Text style={styles.cardDescription}>
            Sign into the same Tailscale account on the bridge and your iPhone, then paste the bridge IP above.
          </Text>

          <Text style={[styles.stepTitle, { marginTop: SPACING.md }]}>3. Add your printer</Text>
          <Text style={styles.cardDescription}>
            Open the bridge setup page on that computer and add the printer there. The iPhone never needs the printer LAN IP or access code.
          </Text>
        </View>

        <Text style={styles.sectionTitle}>Remote Printing</Text>
        <View style={styles.card}>
          <Text style={styles.cardDescription}>
            Your iPhone only needs to reach the bridge. The bridge must be at home with the printer or connected to your home LAN through VPN/subnet routing, so Tailscale works from cellular, work Wi-Fi, and travel networks.
          </Text>
        </View>

        <Text style={styles.sectionTitle}>About</Text>
        <View style={styles.card}>
          <View style={styles.aboutRow}>
            <Text style={styles.aboutLabel}>Version</Text>
            <Text style={styles.aboutValue}>2.0.0</Text>
          </View>
          <View style={styles.aboutRow}>
            <Text style={styles.aboutLabel}>Printers</Text>
            <Text style={styles.aboutValue}>P1S, P1P, X1C, A1, A1 mini</Text>
          </View>
          <View style={styles.aboutRow}>
            <Text style={styles.aboutLabel}>Files</Text>
            <Text style={styles.aboutValue}>STL, 3MF</Text>
          </View>
        </View>

        <View style={{ height: 80 }} />
      </ScrollView>
    </View>
  );
}

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
    color: COLORS.text,
    fontWeight: '700',
  },
  statusSubtext: {
    ...FONTS.small,
    marginTop: 2,
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
  savedUrl: {
    ...FONTS.small,
    color: COLORS.primary,
    marginTop: SPACING.sm,
  },
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
