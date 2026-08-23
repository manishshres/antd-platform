import React from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { Text, TouchableRipple } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { antd, RADIUS } from '../../theme';
import { formatMoney } from '../../utils/money';
import { listStyles } from './listStyles';
import type { LocalOrder, LocalOrderStatus } from '../../types';

interface Props {
  orders: LocalOrder[];
  selectedId: string | null;
  onSelect: (o: LocalOrder) => void;
  emptyLabel: string;
  emptyIcon: string;
}

/** Human label + colour for a local order's lifecycle state. */
function statusMeta(status: LocalOrderStatus): { label: string; color: string } {
  switch (status) {
    case 'held':
      return { label: 'Held', color: antd.warning };
    case 'open_tab':
      return { label: 'Sent', color: antd.primary };
    case 'pending_sync':
      return { label: 'Syncing', color: antd.textSecondary };
    case 'failed':
      return { label: 'Sync failed', color: antd.error };
    case 'synced':
      return { label: 'Synced', color: antd.success };
    case 'incoming':
      // A phone order the AI took, or one rung up elsewhere — it needs attention on this
      // register, so it reads as new rather than as something already handled here.
      return { label: 'New', color: antd.warning };
  }
}

/** e.g. "just now", "8m", "2h 5m" — how long the order has been open. */
function elapsed(fromIso: string): string {
  const mins = Math.floor((Date.now() - new Date(fromIso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  return `${h}h ${mins % 60}m`;
}

const TYPE_LABEL: Record<string, string> = {
  dine_in: 'Dine-in',
  pickup: 'Takeout',
  delivery: 'Delivery',
};

/**
 * One rich order row shared across the Active / Held / Unsynced filters — the
 * old panels showed only customer + total, which made it impossible to triage
 * at a glance. Now every card carries ticket, type, table, elapsed time, a
 * status pill, payment state, and total.
 */
export function OrdersListPanel({
  orders,
  selectedId,
  onSelect,
  emptyLabel,
  emptyIcon,
}: Props) {
  return (
    <View style={{ flex: 1 }}>
      <FlatList
        data={orders}
        keyExtractor={(o) => o.id}
        contentContainerStyle={orders.length === 0 ? { flex: 1 } : { paddingVertical: 4 }}
        ListEmptyComponent={
          <View style={listStyles.emptyState}>
            <MaterialCommunityIcons name={emptyIcon as never} size={40} color={antd.textQuaternary} />
            <Text variant="bodyMedium" style={{ color: antd.textTertiary }}>{emptyLabel}</Text>
          </View>
        }
        renderItem={({ item }) => {
          const selected = item.id === selectedId;
          const meta = statusMeta(item.status);
          const typeLabel = item.orderType ? TYPE_LABEL[item.orderType] ?? item.orderType : null;
          const paid = Boolean(item.paymentMethod);
          return (
            <TouchableRipple onPress={() => onSelect(item)} borderless>
              <View style={[styles.card, selected && styles.cardSelected]}>
                <View style={styles.topRow}>
                  <Text style={styles.ticket} numberOfLines={1}>
                    {item.ticketNumber ? `#${item.ticketNumber}` : item.customerName}
                  </Text>
                  <View style={[styles.statusPill, { backgroundColor: meta.color }]}>
                    <Text style={styles.statusPillText}>{meta.label}</Text>
                  </View>
                </View>

                <View style={styles.metaRow}>
                  {item.ticketNumber ? (
                    <Text style={styles.metaText} numberOfLines={1}>{item.customerName}</Text>
                  ) : null}
                  {typeLabel && <Chip icon="silverware-fork-knife" text={typeLabel} />}
                  {item.tableName && <Chip icon="table-furniture" text={`Table ${item.tableName}`} />}
                  <Chip icon="clock-outline" text={elapsed(item.createdAt)} />
                </View>

                <View style={styles.bottomRow}>
                  <View style={styles.payState}>
                    <MaterialCommunityIcons
                      name={paid ? 'check-circle' : 'circle-outline'}
                      size={13}
                      color={paid ? antd.success : antd.textTertiary}
                    />
                    <Text style={[styles.payText, { color: paid ? antd.success : antd.textTertiary }]}>
                      {paid ? 'Paid' : 'Unpaid'}
                    </Text>
                  </View>
                  <Text style={styles.amount}>{formatMoney(item.totalAmount)}</Text>
                </View>
              </View>
            </TouchableRipple>
          );
        }}
      />
    </View>
  );
}

function Chip({ icon, text }: { icon: string; text: string }) {
  return (
    <View style={styles.chip}>
      <MaterialCommunityIcons name={icon as never} size={12} color={antd.textSecondary} />
      <Text style={styles.chipText} numberOfLines={1}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: antd.split,
    gap: 8,
  },
  cardSelected: { backgroundColor: antd.primaryBg },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  ticket: { flex: 1, color: antd.text, fontWeight: '700', fontSize: 15 },
  statusPill: { borderRadius: RADIUS, paddingHorizontal: 8, paddingVertical: 2 },
  statusPillText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  metaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  metaText: { color: antd.textSecondary, fontSize: 12, maxWidth: 120 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: antd.bgLayout,
    borderRadius: RADIUS,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  chipText: { color: antd.textSecondary, fontSize: 11 },
  bottomRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  payState: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  payText: { fontSize: 12, fontWeight: '600' },
  amount: { color: antd.text, fontWeight: '700', fontSize: 15 },
});
