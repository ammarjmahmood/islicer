import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import * as Linking from 'expo-linking';
import { COLORS, FONTS, RADIUS, SPACING } from '../constants/theme';
import { codeFromInput, formatCode, getPairCode, pair, unpair } from '../services/pairing';
import { resolveBridgeUrl } from '../services/bridge';

type Status = 'unpaired' | 'checking' | 'online' | 'offline';

/** One-time pairing with the bridge computer: scan its QR code, or type the code. */
export default function PairingCard({ onChange }: { onChange?: () => void }) {
  const [status, setStatus] = useState<Status>('checking');
  const [code, setCode] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();

  const check = useCallback(async () => {
    const saved = await getPairCode();
    setCode(saved);
    if (!saved) {
      setStatus('unpaired');
      return;
    }
    setStatus('checking');
    try {
      await resolveBridgeUrl();
      setStatus('online');
      setMessage(null);
    } catch (err: any) {
      setStatus('offline');
      setMessage(err.message);
    }
  }, []);

  const submit = useCallback(
    async (input: string) => {
      if (busy) return;
      setBusy(true);
      setMessage(null);
      try {
        await pair(input);
        setTyped('');
        await check();
        onChange?.();
      } catch (err: any) {
        setMessage(err.message);
      } finally {
        setBusy(false);
      }
    },
    [busy, check, onChange],
  );

  useEffect(() => {
    check();
    // islicer://pair?c=... opened from the camera app or a link
    const handle = ({ url }: { url: string }) => {
      if (codeFromInput(url) && /pair/.test(url)) submit(url);
    };
    Linking.getInitialURL().then((url) => url && handle({ url }));
    const subscription = Linking.addEventListener('url', handle);
    return () => subscription.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function openScanner() {
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) {
        setMessage('Camera access is off. Type the code instead, or allow the camera in Settings.');
        return;
      }
    }
    setScanning(true);
  }

  const paired = status !== 'unpaired';
  const dot = status === 'online' ? COLORS.success : status === 'offline' ? COLORS.error : COLORS.textMuted;

  return (
    <View style={styles.card}>
      <View style={styles.row}>
        {status === 'checking' ? (
          <ActivityIndicator size="small" color={COLORS.primary} />
        ) : (
          <View style={[styles.dot, { backgroundColor: dot }]} />
        )}
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>
            {status === 'online'
              ? 'Connected to your bridge'
              : status === 'offline'
                ? 'Bridge not reachable'
                : status === 'checking'
                  ? 'Checking…'
                  : 'Pair with your computer'}
          </Text>
          <Text style={styles.sub}>
            {paired && code
              ? `Paired · ${formatCode(code).slice(0, 4)}-••••-••••`
              : 'On your bridge computer, open the pairing page and scan the code.'}
          </Text>
        </View>
        {paired && (
          <TouchableOpacity onPress={check} hitSlop={10}>
            <Ionicons name="refresh" size={20} color={COLORS.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      {!!message && <Text style={styles.message}>{message}</Text>}

      {!paired && (
        <>
          <TouchableOpacity style={styles.primary} onPress={openScanner} disabled={busy}>
            {busy ? <ActivityIndicator color="#fff" /> : <Ionicons name="qr-code" size={20} color="#fff" />}
            <Text style={styles.primaryText}>{busy ? 'Pairing…' : 'Scan pairing code'}</Text>
          </TouchableOpacity>
          <Text style={styles.or}>or type it</Text>
          <View style={styles.codeRow}>
            <TextInput
              style={styles.input}
              placeholder="XXXX-XXXX-XXXX"
              placeholderTextColor={COLORS.textMuted}
              autoCapitalize="characters"
              autoCorrect={false}
              value={typed}
              onChangeText={(text) => setTyped(formatCode(text))}
              maxLength={14}
              onSubmitEditing={() => submit(typed)}
              returnKeyType="go"
            />
            <TouchableOpacity
              style={[styles.go, !codeFromInput(typed) && { opacity: 0.4 }]}
              disabled={!codeFromInput(typed) || busy}
              onPress={() => submit(typed)}
            >
              <Text style={styles.goText}>Pair</Text>
            </TouchableOpacity>
          </View>
        </>
      )}

      {paired && (
        <TouchableOpacity
          style={styles.unpair}
          onPress={async () => {
            await unpair();
            setMessage(null);
            await check();
            onChange?.();
          }}
        >
          <Text style={styles.unpairText}>Unpair this phone</Text>
        </TouchableOpacity>
      )}

      <Modal visible={scanning} animationType="slide" onRequestClose={() => setScanning(false)}>
        <View style={styles.scanner}>
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={({ data }) => {
              if (!codeFromInput(data)) return;
              setScanning(false);
              submit(data);
            }}
          />
          <View style={styles.scanFrame} />
          <Text style={styles.scanHint}>Point at the code on your bridge computer</Text>
          <TouchableOpacity style={styles.scanClose} onPress={() => setScanning(false)}>
            <Text style={styles.primaryText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, padding: SPACING.md, gap: SPACING.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  dot: { width: 12, height: 12, borderRadius: 6 },
  title: { ...FONTS.body, fontWeight: '700' },
  sub: { ...FONTS.small, marginTop: 2 },
  message: { ...FONTS.small, color: COLORS.error },
  primary: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.md,
    paddingVertical: 14,
    marginTop: SPACING.xs,
  },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  or: { ...FONTS.small, textAlign: 'center' },
  codeRow: { flexDirection: 'row', gap: SPACING.sm },
  input: {
    flex: 1,
    backgroundColor: COLORS.bg,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: 12,
    color: COLORS.text,
    fontSize: 17,
    letterSpacing: 1.5,
    fontVariant: ['tabular-nums'],
  },
  go: { backgroundColor: COLORS.primary, borderRadius: RADIUS.md, paddingHorizontal: 20, justifyContent: 'center' },
  goText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  unpair: { alignSelf: 'flex-start', paddingVertical: 4 },
  unpairText: { ...FONTS.small, color: COLORS.textMuted, textDecorationLine: 'underline' },
  scanner: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  scanFrame: { width: 250, height: 250, borderRadius: 28, borderWidth: 3, borderColor: '#fff' },
  scanHint: { color: '#fff', fontSize: 16, fontWeight: '600', marginTop: 24 },
  scanClose: { position: 'absolute', bottom: 60, backgroundColor: 'rgba(255,255,255,0.2)', paddingHorizontal: 28, paddingVertical: 14, borderRadius: 999 },
});
