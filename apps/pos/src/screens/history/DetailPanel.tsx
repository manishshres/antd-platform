import React, { useState } from 'react';
import { Alert, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { ActivityIndicator, Button, Divider, Text } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { antd, RADIUS } from '../../theme';
import { formatMoney } from '../../utils/money';
import { fmtDateOnly } from '../../utils/dates';
import { OrderStatusChip } from '../../components/OrderStatusChip';
import { ManagerPinPrompt } from '../../components/ManagerPinPrompt';
import { unfiredCourses } from '../../db/tabsRepo';
import { ApiRequestError, type ApiClient } from '../../api/client';
import { printReceipt, printKitchenTicketsByStation, type StationPrintResult } from '../../printing/printerService';
import { useEmployee } from '../../state/EmployeeContext';
import {
  COURSE_LABELS,
  paymentMethodLabel,
  type Course,
  type LocalOrder,
  type OrderType,
  type PaymentMethod,
  type PosSettings,
  type ServerOrderDetail,
} from '../../types';
import type { ActiveTab, DetailState } from './types';

/** Server order details lack a few fields only local carts track (tip, service
 *  charge, loyalty redemption) — those print as zero, which is correct for any
 *  order old enough to only exist server-side (the receipt already includes
 *  them baked into totalAmount at the time they were charged). */
function toLocalOrderForPrint(order: ServerOrderDetail): LocalOrder {
  return {
    id: order.id,
    serverId: order.id,
    ticketNumber: order.ticketNumber,
    status: 'synced',
    items: order.items.map((item) => ({
      menuItemId: item.menuItemId,
      name: item.name,
      unitPrice: item.unitPrice,
      quantity: item.quantity,
      notes: item.notes ?? undefined,
      course: item.course ?? undefined,
      firedAt: item.firedAt,
    })),
    customerId: order.customer?.id ?? null,
    customerName: order.customer?.name ?? order.customerName,
    customerPhone: order.customerPhone,
    tableId: order.table?.id ?? order.tableId,
    tableName: order.table?.name ?? order.tableName,
    guests: null,
    orderType: (order.orderType as OrderType) ?? 'dine_in',
    subtotal: order.subtotal ?? 0,
    discountId: null,
    discountName: null,
    discountAmount: order.discountAmount ?? 0,
    taxAmount: order.taxAmount ?? 0,
    totalAmount: order.totalAmount,
    paymentMethod: (order.paymentMethod as PaymentMethod) ?? null,
    tenderedAmount: order.tenderedAmount,
    changeAmount: order.changeAmount,
    tipAmount: 0,
    serviceChargeAmount: 0,
    loyaltyPointsRedeemed: 0,
    specialInstructions: order.specialInstructions,
    errorMessage: null,
    createdAt: order.createdAt,
    syncedAt: null,
    tabOpenedAt: null,
    fireMode: 'all',
    // This order was placed (possibly on another register) and fetched back from
    // the server — it isn't tied to a business day open on this device.
    businessDayId: null,
  };
}

/** One line per station outcome, e.g. "Grill: printed", "Bar: printer offline". */
function summarizeStationResults(results: StationPrintResult[]): string {
  return results
    .map((r) => `${r.stationName}: ${r.result.ok ? 'printed' : r.result.error ?? 'failed'}`)
    .join('\n');
}

/** Wall-clock time a course went to the kitchen ("fired 7:42 PM"). */
function fmtTimeOnly(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

interface DetailPanelProps {
  detail: DetailState;
  tab: ActiveTab;
  onResume: (o: LocalOrder) => void;
  onDiscard: (o: LocalOrder) => void;
  onRetry: (o: LocalOrder) => void;
  onFireCourse?: (o: LocalOrder, course: Course) => void;
  /** Needed to call the void/refund endpoint from the server order view. */
  client?: ApiClient;
  /** Called after a successful void/refund so the caller can reload the order + list. */
  onVoided?: () => void;
  /** Needed to reprint to the register's own Bluetooth printer, if one's configured. */
  settings: PosSettings;
}

/** Right-hand order detail: empty/loading/error, local receipt, or server receipt. */
export function DetailPanel({ detail, tab, onResume, onDiscard, onRetry, onFireCourse, client, onVoided, settings }: DetailPanelProps) {
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
          onFireCourse={onFireCourse}
        />
      </ScrollView>
    );
  }

  return (
    <ScrollView style={styles.detailScroll} contentContainerStyle={styles.detailContent}>
      <ServerOrderDetailView order={detail.order} client={client} onVoided={onVoided} settings={settings} />
    </ScrollView>
  );
}

// ── Local order detail ────────────────────────────────────────────────────────

function LocalOrderDetail({
  order, tab, onResume, onDiscard, onRetry, onFireCourse,
}: {
  order: LocalOrder;
  tab: ActiveTab;
  onResume: (o: LocalOrder) => void;
  onDiscard: (o: LocalOrder) => void;
  onRetry: (o: LocalOrder) => void;
  onFireCourse?: (o: LocalOrder, course: Course) => void;
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
        <View key={`${item.menuItemId}-${item.course ?? 0}-${i}`} style={styles.lineItem}>
          <Text style={styles.lineIdx}>{i + 1}.</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.lineName}>{item.name}</Text>
            {item.course ? (
              <Text style={styles.lineNote}>
                {COURSE_LABELS[item.course]}
                {item.firedAt ? ` · fired ${fmtTimeOnly(item.firedAt)}` : ' · not fired'}
              </Text>
            ) : null}
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
          <TotalRow label={paymentMethodLabel(order.paymentMethod)} value={formatMoney(order.tenderedAmount)} />
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
        {tab === 'tabs' && (
          <>
            {/* Firing happens here, long after the cart is gone — this is
                where a server stands when the apps come back cleared. */}
            {order.fireMode === 'by_course' &&
              unfiredCourses(order).map((course) => (
                <Button
                  key={course}
                  mode="contained"
                  onPress={() => onFireCourse?.(order, course)}
                  style={styles.actionBtn}
                  contentStyle={styles.actionBtnContent}
                  buttonColor={antd.warning}
                  icon="fire"
                >
                  {`Fire ${COURSE_LABELS[course]}`}
                </Button>
              ))}
            <Button
              mode="contained"
              onPress={() => onResume(order)}
              style={[styles.actionBtn, { flex: 1 }]}
              contentStyle={styles.actionBtnContent}
              icon="plus"
            >
              Add to Tab
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

function ServerOrderDetailView({
  order,
  client,
  onVoided,
  settings,
}: {
  order: ServerOrderDetail;
  client?: ApiClient;
  onVoided?: () => void;
  settings: PosSettings;
}) {
  const name = order.customer?.name ?? order.customerName;
  const tableLabel = order.table?.name
    ? `${order.orderType === 'dine_in' ? 'Dine-In' : 'Pickup'} • Table ${order.table.name}`
    : order.orderType === 'dine_in' ? 'Dine-In' : 'Pickup';

  const { employee } = useEmployee();
  const [voidPromptOpen, setVoidPromptOpen] = useState(false);
  const [voidBusy, setVoidBusy] = useState(false);
  const [voidError, setVoidError] = useState<string | null>(null);

  const canVoid =
    Boolean(client) &&
    order.paidAt != null &&
    order.status !== 'refunded' &&
    order.status !== 'cancelled';

  const submitVoid = async (pin: string) => {
    if (!client) return;
    setVoidBusy(true);
    setVoidError(null);
    try {
      await client.refundOrder(order.id, { managerPin: pin, reason: 'Voided from POS' });
      setVoidPromptOpen(false);
      onVoided?.();
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 403) {
        setVoidError('Invalid manager PIN.');
      } else {
        setVoidError(err instanceof Error ? err.message : 'Could not void this order.');
      }
    } finally {
      setVoidBusy(false);
    }
  };

  const [kitchenPrinting, setKitchenPrinting] = useState(false);
  const reprintKitchen = async () => {
    if (kitchenPrinting) return;
    setKitchenPrinting(true);
    try {
      const results = await printKitchenTicketsByStation(
        toLocalOrderForPrint(order),
        settings,
        employee?.displayName ?? null,
        settings.locationName,
      );
      Alert.alert('Kitchen Tickets', summarizeStationResults(results));
    } finally {
      setKitchenPrinting(false);
    }
  };

  const [printing, setPrinting] = useState(false);
  const reprint = async () => {
    if (printing) return;
    setPrinting(true);
    try {
      if (settings.printerEnabled) {
        // A Bluetooth printer set up on this register prints directly —
        // there's no reason to round-trip through the server's own (separate,
        // MQTT-based) printer dispatch for a receipt this register can print itself.
        const result = await printReceipt(toLocalOrderForPrint(order), settings, settings.locationName);
        if (!result.ok) throw new Error(result.error);
        Alert.alert('Printed', 'The receipt was sent to the printer.');
      } else if (client) {
        await client.printOrder(order.id);
        Alert.alert('Sent to Printer', 'The kitchen ticket / receipt is reprinting.');
      } else {
        throw new Error('No printer configured — set one up in Settings → Printer.');
      }
    } catch (err) {
      Alert.alert(
        'Print Failed',
        err instanceof Error ? err.message : 'Could not reach the printer.',
      );
    } finally {
      setPrinting(false);
    }
  };

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
          <TotalRow label={paymentMethodLabel(order.paymentMethod)} value={formatMoney(order.tenderedAmount)} />
          {(order.changeAmount ?? 0) > 0 && (
            <TotalRow label="Balance" value={formatMoney(order.changeAmount)} />
          )}
        </>
      )}

      <TouchableOpacity
        style={[styles.printBtn, printing && { opacity: 0.6 }]}
        activeOpacity={0.8}
        disabled={printing || (!settings.printerEnabled && !client)}
        onPress={reprint}
      >
        <MaterialCommunityIcons name="printer-outline" size={18} color="#fff" />
        <Text style={styles.printBtnText}>{printing ? 'Sending…' : 'Reprint Invoice'}</Text>
      </TouchableOpacity>

      {settings.printerEnabled && (
        <TouchableOpacity
          style={[styles.printBtn, styles.printBtnSecondary, kitchenPrinting && { opacity: 0.6 }]}
          activeOpacity={0.8}
          disabled={kitchenPrinting}
          onPress={reprintKitchen}
        >
          <MaterialCommunityIcons name="chef-hat" size={18} color={antd.primary} />
          <Text style={[styles.printBtnText, { color: antd.primary }]}>
            {kitchenPrinting ? 'Sending…' : 'Reprint Kitchen Tickets'}
          </Text>
        </TouchableOpacity>
      )}

      {canVoid && (
        <Button
          mode="outlined"
          icon="cancel"
          textColor={antd.error}
          style={[styles.actionBtn, { marginTop: 10, borderColor: antd.errorBorder }]}
          contentStyle={styles.actionBtnContent}
          onPress={() =>
            Alert.alert(
              'Void & Refund Order',
              `This refunds the full ${formatMoney(order.totalAmount)} and voids the order. Requires manager approval.`,
              [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Continue', style: 'destructive', onPress: () => setVoidPromptOpen(true) },
              ],
            )
          }
        >
          Void & Refund
        </Button>
      )}

      <ManagerPinPrompt
        visible={voidPromptOpen}
        title="Approve void & refund"
        reason={`Order ${order.ticketNumber ? `#${order.ticketNumber}` : ''} · ${formatMoney(order.totalAmount)}`}
        busy={voidBusy}
        errorMessage={voidError}
        onSubmit={submitVoid}
        onCancel={() => setVoidPromptOpen(false)}
      />
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
  printBtnSecondary: {
    marginTop: 10,
    backgroundColor: antd.primaryBg,
    borderWidth: 1,
    borderColor: antd.primaryBorder,
  },
  printBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
