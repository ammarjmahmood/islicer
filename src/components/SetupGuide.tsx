import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, RADIUS, SPACING } from '../constants/theme';
import { getPairCode } from '../services/pairing';
import { getBridgePrinters } from '../services/bambu';

/** The three setup steps, ticked off as they are done. Hides itself when all are. */
export default function SetupGuide({ alwaysShow = false }: { alwaysShow?: boolean }) {
  const navigation = useNavigation<any>();
  const [paired, setPaired] = useState(false);
  const [printers, setPrinters] = useState(0);

  useFocusEffect(
    useCallback(() => {
      let live = true;
      (async () => {
        const isPaired = Boolean(await getPairCode());
        if (!live) return;
        setPaired(isPaired);
        if (isPaired) {
          try {
            const list = await getBridgePrinters();
            if (live) setPrinters(list.length);
          } catch {}
        }
      })();
      return () => {
        live = false;
      };
    }, []),
  );

  if (paired && printers > 0 && !alwaysShow) return null;

  return (
    <View style={styles.card}>
      <Text style={styles.heading}>Get set up</Text>

      <Row done={paired} number={1} title="Install iSlicer Bridge on your home computer">
        A Mac or Ubuntu computer that stays on, on the same network as your printer. Run the one-line installer from Settings; it ends by showing a QR code.
      </Row>

      <Row
        done={paired}
        number={2}
        title="Pair this phone"
        action={paired ? undefined : { label: 'Scan the code', onPress: () => navigation.navigate('Main', { screen: 'Settings' }) }}
      >
        Scan the QR code the installer printed. To see it again, open http://(your computer):8005/pair on a device on your home Wi-Fi.
      </Row>

      <Row
        done={printers > 0}
        number={3}
        title="Add your Bambu printer"
        action={paired && printers === 0 ? { label: 'Add printer', onPress: () => navigation.navigate('AddPrinter') } : undefined}
      >
        Enter the printer's IP address, Access Code and serial number. The app shows where to find each one on the printer's screen.
      </Row>

      <View style={styles.warning}>
        <Ionicons name="key" size={15} color={COLORS.warning} />
        <Text style={styles.warningText}>
          Treat the pairing code like a password. Anyone who has it can print on your printer.
        </Text>
      </View>
    </View>
  );
}

function Row({
  done,
  number,
  title,
  children,
  action,
}: {
  done: boolean;
  number: number;
  title: string;
  children: React.ReactNode;
  action?: { label: string; onPress: () => void };
}) {
  return (
    <View style={styles.row}>
      <View style={[styles.badge, done && { backgroundColor: COLORS.success }]}>
        {done ? <Ionicons name="checkmark" size={16} color="#fff" /> : <Text style={styles.badgeText}>{number}</Text>}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.title, done && { color: COLORS.textSecondary }]}>{title}</Text>
        {!done && <Text style={styles.body}>{children}</Text>}
        {!done && action && (
          <TouchableOpacity style={styles.action} onPress={action.onPress}>
            <Text style={styles.actionText}>{action.label}</Text>
            <Ionicons name="arrow-forward" size={15} color="#fff" />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, padding: SPACING.md, gap: SPACING.md },
  heading: { ...FONTS.heading },
  row: { flexDirection: 'row', gap: SPACING.sm },
  badge: { width: 26, height: 26, borderRadius: 13, backgroundColor: COLORS.surfaceLight, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  badgeText: { color: COLORS.text, fontWeight: '800', fontSize: 13 },
  title: { ...FONTS.body, fontWeight: '700' },
  body: { ...FONTS.small, color: COLORS.textSecondary, marginTop: 3, lineHeight: 19 },
  action: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', backgroundColor: COLORS.primary, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, marginTop: SPACING.sm },
  actionText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  warning: { flexDirection: 'row', gap: SPACING.sm, alignItems: 'flex-start', borderTopWidth: 1, borderTopColor: COLORS.border, paddingTop: SPACING.sm },
  warningText: { ...FONTS.small, color: COLORS.textSecondary, flex: 1, lineHeight: 19 },
});
