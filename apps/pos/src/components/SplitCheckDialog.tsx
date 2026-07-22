import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, Dialog, Divider, Portal, Text, TouchableRipple } from 'react-native-paper';
import { antd, RADIUS } from '../theme';
import { formatMoney } from '../utils/money';
import { lineUnitPrice, splitLines } from '../state/cartOps';
import type { CartLine } from '../types';

const CHECK_LABELS = ['A', 'B', 'C', 'D'];
const CHECK_COUNTS = [2, 3, 4];

interface Props {
  visible: boolean;
  lines: CartLine[];
  onDismiss: () => void;
  onConfirm: (groups: CartLine[][]) => void;
}

/**
 * Assign each cart line to one or more checks before it's fired/paid. A line
 * assigned to more than one check splits its quantity evenly across them
 * (e.g. a shared appetizer); everything else goes whole to a single check.
 */
export function SplitCheckDialog({ visible, lines, onDismiss, onConfirm }: Props) {
  const [checkCount, setCheckCount] = useState(2);
  const [assignment, setAssignment] = useState<Record<string, boolean[]>>({});

  /** Every line shared across the first `count` checks — the common "split the whole bill N ways" case. */
  const evenAssignment = (count: number): Record<string, boolean[]> =>
    Object.fromEntries(
      lines.map((l) => [
        l.id,
        Array.from({ length: 4 }, (_, i) => i < count),
      ]),
    );

  useEffect(() => {
    if (visible) {
      setCheckCount(2);
      // Default to splitting everything evenly — the common case needs zero
      // taps; the cashier only touches per-item chips to hand specific items
      // to specific people.
      setAssignment(evenAssignment(2));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, lines]);

  const toggle = (key: string, checkIndex: number) => {
    setAssignment((prev) => {
      const flags = [...(prev[key] ?? [false, false, false, false])];
      flags[checkIndex] = !flags[checkIndex];
      // Never leave a line assigned to nothing — that's how a plate silently
      // vanishes off the bill.
      if (!flags.some(Boolean)) flags[0] = true;
      return { ...prev, [key]: flags };
    });
  };

  const splitEvenly = () => setAssignment(evenAssignment(checkCount));

  const groups = splitLines(lines, assignment, checkCount);
  const groupTotal = (group: CartLine[]) =>
    group.reduce((sum, l) => sum + lineUnitPrice(l) * l.quantity, 0);

  return (
    <Portal>
      <Dialog visible={visible} onDismiss={onDismiss} style={styles.dialog}>
        <Dialog.Title>Split Check</Dialog.Title>
        <Dialog.Content style={{ gap: 12 }}>
          <View style={styles.countRow}>
            <Text variant="labelMedium" style={{ color: antd.textSecondary }}>
              Number of checks
            </Text>
            <View style={styles.countChips}>
              {CHECK_COUNTS.map((n) => (
                <TouchableRipple
                  key={n}
                  onPress={() => setCheckCount(n)}
                  style={[styles.countChip, checkCount === n && styles.countChipActive]}
                  borderless
                >
                  <Text
                    style={[
                      styles.countChipText,
                      checkCount === n && styles.countChipTextActive,
                    ]}
                  >
                    {n}
                  </Text>
                </TouchableRipple>
              ))}
            </View>
          </View>

          <Button
            mode="outlined"
            icon="call-split"
            compact
            onPress={splitEvenly}
            style={{ borderRadius: RADIUS, alignSelf: 'flex-start' }}
          >
            Split Evenly
          </Button>

          <Text variant="labelSmall" style={{ color: antd.textTertiary }}>
            Everything is split evenly across all checks by default. Tap a check letter on an
            item to hand it to just that person instead.
          </Text>

          <ScrollView style={styles.list}>
            {lines.map((line) => {
              const key = line.id;
              const flags = assignment[key] ?? [true, false, false, false];
              return (
                <View key={key} style={styles.lineRow}>
                  <View style={{ flex: 1 }}>
                    <Text variant="bodyMedium" style={{ color: antd.text }} numberOfLines={1}>
                      {line.quantity} × {line.product.name}
                    </Text>
                    <Text variant="labelSmall" style={{ color: antd.textTertiary }}>
                      {formatMoney(lineUnitPrice(line) * line.quantity)}
                    </Text>
                  </View>
                  <View style={styles.checkChips}>
                    {CHECK_LABELS.slice(0, checkCount).map((label, i) => (
                      <TouchableRipple
                        key={label}
                        onPress={() => toggle(key, i)}
                        style={[styles.checkChip, flags[i] && styles.checkChipActive]}
                        borderless
                      >
                        <Text
                          style={[
                            styles.checkChipText,
                            flags[i] && styles.checkChipTextActive,
                          ]}
                        >
                          {label}
                        </Text>
                      </TouchableRipple>
                    ))}
                  </View>
                </View>
              );
            })}
          </ScrollView>

          <Divider />

          <View style={styles.summaryRow}>
            {groups.map((group, i) => (
              <View key={CHECK_LABELS[i]} style={styles.summaryChip}>
                <Text variant="labelSmall" style={{ color: antd.textSecondary }}>
                  Check {CHECK_LABELS[i]}
                </Text>
                <Text variant="bodyMedium" style={{ color: antd.text, fontWeight: '700' }}>
                  {formatMoney(groupTotal(group))}
                </Text>
              </View>
            ))}
          </View>
        </Dialog.Content>
        <Dialog.Actions>
          <Button onPress={onDismiss}>Cancel</Button>
          <Button
            mode="contained"
            disabled={groups.some((g) => g.length === 0)}
            onPress={() => {
              onConfirm(groups);
              onDismiss();
            }}
            style={{ borderRadius: RADIUS }}
          >
            Start Split Pay
          </Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
}

const styles = StyleSheet.create({
  dialog: {
    borderRadius: RADIUS,
    backgroundColor: antd.bgContainer,
    maxWidth: 520,
    alignSelf: 'center',
    width: '100%',
  },
  countRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  countChips: { flexDirection: 'row', gap: 8 },
  countChip: {
    width: 36,
    height: 36,
    borderRadius: RADIUS,
    borderWidth: 1,
    borderColor: antd.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countChipActive: { borderColor: antd.primary, backgroundColor: antd.primaryBg },
  countChipText: { fontWeight: '700', color: antd.textSecondary },
  countChipTextActive: { color: antd.primary },
  list: { maxHeight: 280 },
  lineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: antd.split,
  },
  checkChips: { flexDirection: 'row', gap: 6 },
  checkChip: {
    width: 32,
    height: 32,
    borderRadius: RADIUS,
    borderWidth: 1,
    borderColor: antd.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkChipActive: { borderColor: antd.primary, backgroundColor: antd.primary },
  checkChipText: { fontWeight: '700', fontSize: 12, color: antd.textSecondary },
  checkChipTextActive: { color: '#fff' },
  summaryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  summaryChip: {
    borderRadius: RADIUS,
    borderWidth: 1,
    borderColor: antd.split,
    paddingHorizontal: 12,
    paddingVertical: 6,
    gap: 2,
  },
});
