import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { antd, RADIUS } from '../theme';

const STYLES: Record<string, { bg: string; border: string; fg: string; label: string }> = {
  held: { bg: antd.warningBg, border: antd.warningBorder, fg: antd.warning, label: 'On Hold' },
  open_tab: { bg: antd.primaryBg, border: antd.primaryBorder, fg: antd.primary, label: 'Open Tab' },
  pending_sync: { bg: antd.warningBg, border: antd.warningBorder, fg: antd.warning, label: 'Pending Sync' },
  synced: { bg: antd.successBg, border: antd.successBorder, fg: antd.success, label: 'Synced' },
  failed: { bg: antd.errorBg, border: antd.errorBorder, fg: antd.error, label: 'Failed' },
  pending: { bg: antd.primaryBg, border: antd.primaryBorder, fg: antd.primary, label: 'Pending' },
  confirmed: { bg: antd.primaryBg, border: antd.primaryBorder, fg: antd.primary, label: 'Confirmed' },
  preparing: { bg: antd.warningBg, border: antd.warningBorder, fg: antd.warning, label: 'Preparing' },
  ready: { bg: antd.successBg, border: antd.successBorder, fg: antd.success, label: 'Ready' },
  completed: { bg: antd.successBg, border: antd.successBorder, fg: antd.success, label: 'Completed' },
  cancelled: { bg: antd.errorBg, border: antd.errorBorder, fg: antd.error, label: 'Cancelled' },
};

export function OrderStatusChip({ status }: { status: string }) {
  const s = STYLES[status] ?? {
    bg: antd.bgLayout,
    border: antd.border,
    fg: antd.textSecondary,
    label: status,
  };
  return (
    <View style={[styles.chip, { backgroundColor: s.bg, borderColor: s.border }]}>
      <Text style={[styles.text, { color: s.fg }]}>{s.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    borderWidth: 1,
    borderRadius: RADIUS,
    paddingHorizontal: 8,
    paddingVertical: 2,
    alignSelf: 'flex-start',
  },
  text: { fontSize: 12, fontWeight: '600' },
});
