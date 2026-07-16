import React from 'react';
import { Alert, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { ActivityIndicator, Button, Divider, Text } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { antd, RADIUS } from '../../theme';
import { formatMoney } from '../../utils/money';
import { fmtDateOnly } from '../../utils/dates';
import { OrderStatusChip } from '../../components/OrderStatusChip';
import type { LocalOrder, ServerOrderDetail } from '../../types';
import type { ActiveTab, DetailState } from './types';

interface DetailPanelProps {
  detail: DetailState;
  tab: ActiveTab;
  onResume: (o: LocalOrder) => void;
  onDiscard: (o: LocalOrder) => void;
  onRetry: (o: LocalOrder) => void;
}

/** Right-hand order detail: empty/loading/error, local receipt, or server receipt. */
export function DetailPanel({ detail, tab, onResume, onDiscard, onRetry }: DetailPanelProps) {
  if (detail.kind === 'empty') {
    return (
      <View style={styles.detailEmpty}>
        <MaterialCommunityIcons name="receipt-text-outline" size={48} color={antd.textQuaternary} />
        <Text variant="bodyMedium" style={{ color: antd.textTertiary, marginTop: 12 }}>
          Select an order to view details
        </Text>
      </View>
    );
  }

  if (detail.kind === 'loading') {
    return <View style={styles.detailEmpty}><ActivityIndicator /></View>;
  }

  if (detail.kind === 'error') {
    return (
      <View style={styles.detailEmpty}>
        <MaterialCommunityIcons name="alert-circle-outline" size={40} color={antd.error} />
        <Text variant="bodyMedium" style={{ color: antd.textTertiary, marginTop: 8 }}>{detail.message}</Text>
      </View>
    );
  }

  if (detail.kind === 'local') {
    return (
      <ScrollView style={styles.detailScroll} contentContainerStyle={styles.detailContent}>
        <LocalOrderDetail
          order={detail.order}
          tab={tab}
          onResume={onResume}
          onDiscard={onDiscard}
          onRetry={onRetry}
        />
      </ScrollView>
    );
  }

  return (
    <ScrollView style={styles.detailScroll} contentContainerStyle={styles.detailContent}>
      <ServerOrderDetailView order={detail.order} />
    </ScrollView>
  );
}

// ── Local order detail ────────────────────────────────────────────────────────

function LocalOrderDetail({
  order, tab, onResume, onDiscard, onRetry,
}: {
  order: LocalOrder;
  tab: ActiveTab;
  onResume: (o: LocalOrder) => void;
  onDiscard: (o: LocalOrder) => void;
  onRetry: (o: LocalOrder) => void;
}) {
  const ticket = order.ticketNumber ? `#${order.ticketNumber}` : order.id.slice(0, 8).toUpperCase();
  const tableLabel = order.tableName
    ? `${order.orderType === 'dine_in' ? 'Dine-In' : 'Pickup'} • Table ${order.tableName}`
    : order.orderType === 'dine_in' ? 'Dine-In' : 'Pickup';

  return (
    <>
      <View style={styles.detailHeader}>
        <Text variant="titleMedium" style={styles.detailOrderId}>Order {ticket}</Text>
        <Text variant="bodySmall" style={{ color: antd.textTertiary }}>{fmtDateOnly(order.createdAt)}</Text>
      </View>

      <Text variant="bodyMedium" style={styles.detailMeta}>
        {order.customerName}{'  '}
        <Text style={{ color: antd.textTertiary }}>{tableLabel}</Text>
      </Text>

      {order.specialInstructions ? (
        <Text variant="bodySmall" style={styles.detailNote}>"{order.specialInstructions}"</Text>
      ) : null}

      <Divider style={styles.div} />

      {order.items.map((item, i) => (
        <View key={`${item.menuItemId}-${i}`} style={styles.lineItem}>
          <Text style={styles.lineIdx}>{i + 1}.</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.lineName}>{item.name}</Text>
            {item.notes ? <Text style={styles.lineNote}>{item.notes}</Text> : null}
          </View>
          <Text style={styles.lineQty}>×{item.quantity}</Text>
          <Text style={styles.linePrice}>{formatMoney(item.unitPrice * item.quantity)}</Text>
        </View>
      ))}

      <Divider style={styles.div} />

      <TotalRow label="Subtotal" value={formatMoney(order.subtotal)} />
      {order.discountAmount > 0 && (
        <TotalRow label={order.discountName ?? 'Discount'} value={`-${formatMoney(order.discountAmount)}`} accent />
      )}
      <TotalRow label="Tax" value={formatMoney(order.taxAmount)} />
      <TotalRow label="Grand Total" value={formatMoney(order.totalAmount)} bold />

      {order.paymentMethod && (
        <>
          <Divider style={styles.div} />
          <TotalRow label={order.paymentMethod === 'cash' ? 'Cash' : 'Card'} value={formatMoney(order.tenderedAmount)} />
          {order.changeAmount != null && order.changeAmount > 0 && (
            <TotalRow label="Change" value={formatMoney(order.changeAmount)} />
          )}
        </>
      )}

      {order.errorMessage ? (
        <View style={styles.errorBox}>
          <MaterialCommunityIcons name="alert-circle-outline" size={14} color={antd.error} />
          <Text style={styles.errorText}>{order.errorMessage}</Text>
        </View>
      ) : null}

      <View style={styles.actionRow}>
        {tab === 'hold' && (
          <>
            <Button
              mode="contained"
              onPress={() => onResume(order)}
              style={[styles.actionBtn, { flex: 1 }]}
              contentStyle={styles.actionBtnContent}
            >
              Resume Order
            </Button>
            <Button
              mode="outlined"
              onPress={() =>
                Alert.alert('Discard Order', 'Remove this held order?', [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Discard', style: 'destructive', onPress: () => onDiscard(order) },
                ])
              }
              style={styles.actionBtn}
              contentStyle={styles.actionBtnContent}
              textColor={antd.error}
            >
              Discard
            </Button>
          </>
        )}
        {tab === 'offline' && order.status === 'failed' && (
          <Button
            mode="contained"
            onPress={() => onRetry(order)}
            style={[styles.actionBtn, { flex: 1 }]}
            contentStyle={styles.actionBtnContent}
            icon="refresh"
          >
            Retry Sync
          </Button>
        )}
      </View>
    </>
  );
}

// ── Server order detail ───────────────────────────────────────────────────────

function ServerOrderDetailView({ order }: { order: ServerOrderDetail }) {
  const name = order.customer?.name ?? order.customerName;
  const tableLabel = order.table?.name
    ? `${order.orderType === 'dine_in' ? 'Dine-In' : 'Pickup'} • Table ${order.table.name}`
    : order.orderType === 'dine_in' ? 'Dine-In' : 'Pickup';

  return (
    <>
      <View style={styles.detailHeader}>
        <Text variant="titleMedium" style={styles.detailOrderId}>
          Order {order.ticketNumber ? `#${order.ticketNumber}` : '—'}
        </Text>
        <OrderStatusChip status={order.status} />
      </View>

      <Text variant="bodySmall" style={{ color: antd.textTertiary, marginBottom: 4 }}>
        {fmtDateOnly(order.createdAt)}
      </Text>

      <Text variant="bodyMedium" style={styles.detailMeta}>
        {name}{'  '}
        <Text style={{ color: antd.textTertiary }}>{tableLabel}</Text>
      </Text>

      {order.specialInstructions ? (
        <Text variant="bodySmall" style={styles.detailNote}>"{order.specialInstructions}"</Text>
      ) : null}

      <Divider style={styles.div} />

      {order.items.map((item, i) => (
        <View key={item.id} style={styles.lineItem}>
          <Text style={styles.lineIdx}>{i + 1}.</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.lineName}>{item.name}</Text>
            {item.notes ? <Text style={styles.lineNote}>{item.notes}</Text> : null}
          </View>
          <Text style={styles.lineQty}>×{item.quantity}</Text>
          <Text style={styles.linePrice}>{formatMoney(item.unitPrice * item.quantity)}</Text>
        </View>
      ))}

      <Divider style={styles.div} />

      <TotalRow label="Subtotal" value={formatMoney(order.subtotal)} />
      {(order.discountAmount ?? 0) > 0 && (
        <TotalRow label="Discount" value={`-${formatMoney(order.discountAmount)}`} accent />
      )}
      <TotalRow label="Tax" value={formatMoney(order.taxAmount)} />
      <TotalRow label="Grand Total" value={formatMoney(order.totalAmount)} bold />

      {order.paymentMethod && (
        <>
          <Divider style={styles.div} />
          <TotalRow label={order.paymentMethod === 'cash' ? 'Cash' : 'Card'} value={formatMoney(order.tenderedAmount)} />
          {(order.changeAmount ?? 0) > 0 && (
            <TotalRow label="Balance" value={formatMoney(order.changeAmount)} />
          )}
        </>
      )}

      <TouchableOpacity
        style={styles.printBtn}
        activeOpacity={0.8}
        onPress={() => Alert.alert('Print Invoice', 'Connect a receipt printer in Settings to enable printing.')}
      >
        <MaterialCommunityIcons name="printer-outline" size={18} color="#fff" />
        <Text style={styles.printBtnText}>Print Invoice</Text>
      </TouchableOpacity>
    </>
  );
}

// ── Shared sub-components ─────────────────────────────────────────────────────

function TotalRow({
  label, value, bold, accent,
}: { label: string; value: string; bold?: boolean; accent?: boolean }) {
  return (
    <View style={styles.totalRow}>
      <Text style={[styles.totalLabel, bold && styles.totalBold]}>{label}</Text>
      <Text style={[styles.totalValue, bold && styles.totalBold, accent && { color: antd.success }]}>
        {value}
      </Text>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  detailEmpty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 24,
  },
  detailScroll: { flex: 1 },
  detailContent: { padding: 20, paddingBottom: 32 },

  detailHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  detailOrderId: { fontWeight: '700', color: antd.text },
  detailMeta: { color: antd.text, marginBottom: 4 },
  detailNote: { color: antd.textSecondary, fontStyle: 'italic', marginBottom: 4 },

  div: { marginVertical: 12, backgroundColor: antd.split },

  lineItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginBottom: 8,
  },
  lineIdx: { fontSize: 13, color: antd.textTertiary, width: 18 },
  lineName: { fontSize: 13, color: antd.text, fontWeight: '500' },
  lineNote: { fontSize: 11, color: antd.textTertiary, marginTop: 1 },
  lineQty: { fontSize: 13, color: antd.textSecondary, minWidth: 28, textAlign: 'right' },
  linePrice: { fontSize: 13, fontWeight: '600', color: antd.text, minWidth: 64, textAlign: 'right' },

  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  totalLabel: { fontSize: 13, color: antd.textSecondary },
  totalValue: { fontSize: 13, color: antd.text, fontWeight: '500' },
  totalBold: { fontSize: 15, fontWeight: '700', color: antd.text },

  errorBox: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'flex-start',
    backgroundColor: antd.errorBg,
    borderRadius: RADIUS,
    padding: 10,
    marginTop: 12,
    borderWidth: 1,
    borderColor: antd.errorBorder,
  },
  errorText: { flex: 1, fontSize: 12, color: antd.error },

  actionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 20,
  },
  actionBtn: { borderRadius: RADIUS },
  actionBtnContent: { paddingVertical: 4 },

  printBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 20,
    paddingVertical: 14,
    borderRadius: RADIUS,
    backgroundColor: antd.primary,
  },
  printBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
