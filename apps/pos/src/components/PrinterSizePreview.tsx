import React from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { antd, RADIUS } from '../theme';

const MONO = Platform.select({ ios: 'Courier', android: 'monospace', default: 'monospace' });

// Pixel widths kept in the same 32:48 ratio as the printer's real 58mm/80mm
// character counts, so wrapping in this box mirrors wrapping on the paper.
const PAPERS = [
  { mm: '58mm', chars: 32, width: 148 },
  { mm: '80mm', chars: 48, width: 222 },
] as const;

// Below Normal (scale 0) there's no negative width/height multiplier on real
// ESC/POS hardware — XSmall/Small instead switch to the printer's condensed
// "Font B", which is narrower per character than the default "Font A" (see
// widthMultiplierFor). Font sizes below are just this preview's on-screen
// approximation of that, not dot-for-dot printer output.
function fontSizeFor(scale: number): number {
  if (scale < 0) return scale === -2 ? 6 : 7;
  return 8 + scale * 3;
}

/** How much wider each printed character is than Font B's baseline — mirrors
 *  printerService's real widthtimes/fonttype choice for a given scale. */
function widthMultiplierFor(scale: number): number {
  if (scale < 0) return 0.75; // Font B (condensed) is narrower than Font A
  return scale + 1; // Font A at its normal/double/triple/quad width step
}

interface Props {
  fontScale: -2 | -1 | 0 | 1 | 2 | 3;
}

/** Side-by-side mock-up of a receipt at the current font scale, on 58mm vs 80mm paper. */
export function PrinterSizePreview({ fontScale }: Props) {
  const fontSize = fontSizeFor(fontScale);

  return (
    <View style={styles.row}>
      {PAPERS.map((paper) => {
        // Real thermal printers wrap an over-wide line rather than clipping it —
        // showing that here is what actually communicates "large text uses more paper".
        const approxChars = Math.max(6, Math.round(paper.chars / widthMultiplierFor(fontScale)));
        return (
          <View key={paper.mm} style={styles.paperWrap}>
            <Text variant="labelSmall" style={styles.paperLabel}>
              {paper.mm} paper
            </Text>
            <View style={[styles.paper, { width: paper.width }]}>
              <Text style={[styles.line, styles.center, styles.bold, { fontSize: fontSize + 2 }]}>
                Coneeko Deli
              </Text>
              <Text style={[styles.line, { fontSize }]}>2 x Cheeseburger Deluxe</Text>
              <View style={styles.totalsRow}>
                <Text style={[styles.line, { fontSize }]}>Total</Text>
                <Text style={[styles.line, styles.bold, { fontSize }]}>$24.50</Text>
              </View>
            </View>
            <Text variant="labelSmall" style={styles.caption}>
              ~{approxChars} chars/line at this size
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 16, marginTop: 4 },
  paperWrap: { alignItems: 'center' },
  paperLabel: { color: antd.textSecondary, marginBottom: 4 },
  paper: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: antd.border,
    borderRadius: RADIUS,
    paddingVertical: 8,
    paddingHorizontal: 6,
    gap: 2,
  },
  line: { fontFamily: MONO, color: '#111', includeFontPadding: false },
  center: { textAlign: 'center' },
  bold: { fontWeight: '700' },
  totalsRow: { flexDirection: 'row', justifyContent: 'space-between' },
  caption: { color: antd.textTertiary, marginTop: 4 },
});
