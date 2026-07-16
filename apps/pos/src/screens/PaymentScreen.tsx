import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, Divider, Text, TouchableRipple } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { antd, RADIUS } from '../theme';
import { useApp } from '../state/AppContext';
import { useCart } from '../state/CartContext';
import * as ordersRepo from '../db/ordersRepo';
import { NumPad } from '../components/NumPad';
import { syncEngine } from '../sync/syncEngine';
import { formatMoney } from '../utils/money';
import type { PaymentMethod } from '../types';
import type { ScreenName } from '../navigation';

const QUICK_TENDER = [500, 1000, 2000, 5000, 10000];

interface Props {
  onNavigate: (screen: ScreenName) => void;
  onCompleted: (message: string) => void;
}

/** Cash / card tender. Works fully offline: the paid order joins the sync queue. */
export function PaymentScreen({ onNavigate, onCompleted }: Props) {
  const { settings, online, syncNow } = useApp();
  const cart = useCart();
  const totals = cart.totals(settings.taxRateBps);
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [tendered, setTendered] = useState(''); // digits, cents
  // P7-001: a single finger tap fires onPress once, but a double-tap on a tablet
  // screen can fire both before the navigation below unmounts. carry out two
  // saveOrder→syncNow runs, generating two newId() orders on the server. Guard
  // the path with a one-shot flag.
  const [confirming, setConfirming] = useState(false);

  const tenderedCents = useMemo(
    () => (tendered ? Number.parseInt(tendered, 10) : 0),
    [tendered],
  );
  const change = tenderedCents - totals.totalAmount;
  const canConfirm =
    !confirming &&
    cart.lines.length > 0 &&
    (method === 'card' || tenderedCents >= totals.totalAmount);

  if (cart.lines.length === 0) {
    return (
      <View style={styles.emptyWrap}>
        <MaterialCommunityIcons
          name="cash-register"
          size={48}
          color={antd.textQuaternary}
        />
        <Text variant="bodyLarge" style={{ color: antd.textTertiary }}>
          The cart is empty — add products first.
        </Text>
        <Button
          mode="contained"
          onPress={() => onNavigate('home')}
          style={{ borderRadius: RADIUS }}
        >
          Back to Catalog
        </Button>
      </View>
    );
  }

  const pressDigit = (d: string) =>
    setTendered((prev) => (prev + d).replace(/^0+(?=\d)/, '').slice(0, 9));
  const backspace = () => setTendered((prev) => prev.slice(0, -1));

  const confirmPayment = () => {
    if (confirming) return;
    setConfirming(true);

    const order = cart.buildOrder(settings.taxRateBps, {
      status: 'pending_sync',
      paymentMethod: method,
      tenderedAmount: method === 'cash' ? tenderedCents : totals.totalAmount,
      changeAmount: method === 'cash' ? Math.max(change, 0) : 0,
    });
    // `buildOrder` calls `newId()` internally. Two concurrent invocations
    // (e.g. a double-tap that fires both onPress before unmount) would mint
    // two distinct client-order ids and the queue would push both. The
    // `confirming` flag short-circuits the second tap before that happens.
    // We intentionally do NOT reset `confirming`: the screen unmounts via
    // onNavigate below and remounting the next sale gets a fresh state.
    ordersRepo.saveOrder(order);
    syncEngine.refreshCounts();
    cart.clear();
    setTendered('');
    if (online) syncNow();
    onCompleted(
      online
        ? `Payment recorded — ${formatMoney(order.totalAmount)} ${method}. Syncing…`
        : `Payment recorded offline — ${formatMoney(order.totalAmount)} ${method}. Will sync when online.`,
    );
    onNavigate('home');
  };

  return (
    <View style={styles.container}>
      {/* Order recap */}
      <View style={styles.summary}>
        <View style={styles.summaryHeader}>
          <Button
            mode="text"
            icon="arrow-left"
            compact
            onPress={() => onNavigate('home')}
            textColor={antd.textSecondary}
          >
            Back
          </Button>
          <Text variant="titleMedium" style={styles.summaryTitle}>
            {cart.customer?.name ?? 'Walk-in customer'}
            {cart.table ? ` · Table ${cart.table.name}` : ''}
          </Text>
        </View>
        <Divider />
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 8 }}>
          {cart.lines.map((line) => (
            <View key={line.product.id} style={styles.summaryLine}>
              <Text variant="bodyMedium" style={styles.lineName} numberOfLines={1}>
                {line.quantity} × {line.product.name}
              </Text>
              <Text variant="bodyMedium" style={styles.lineAmount}>
                {formatMoney(line.product.price * line.quantity)}
              </Text>
            </View>
          ))}
        </ScrollView>
        <View style={styles.summaryTotals}>
          <Row label="Subtotal" value={formatMoney(totals.subtotal)} />
          {totals.discountAmount > 0 && (
            <Row
              label={`Discount${cart.discount ? ` (${cart.discount.name})` : ''}`}
              value={`-${formatMoney(totals.discountAmount)}`}
            />
          )}
          <Row label="Tax" value={formatMoney(totals.taxAmount)} />
          <Divider style={{ marginVertical: 6 }} />
          <Row label="Grand Total" value={formatMoney(totals.totalAmount)} bold />
        </View>
      </View>

      {/* Tender */}
      <View style={styles.tender}>
        <View style={styles.payableCard}>
          <Text variant="labelMedium" style={{ color: antd.textSecondary }}>
            Payable Amount
          </Text>
          <Text variant="headlineMedium" style={styles.payable}>
            {formatMoney(totals.totalAmount)}
          </Text>
        </View>

        <View style={styles.methodTabs}>
          {(['cash', 'card'] as PaymentMethod[]).map((m) => (
            <TouchableRipple
              key={m}
              onPress={() => setMethod(m)}
              style={[styles.methodTab, method === m && styles.methodTabActive]}
              borderless
            >
              <View style={styles.methodInner}>
                <MaterialCommunityIcons
                  name={m === 'cash' ? 'cash' : 'credit-card-outline'}
                  size={20}
                  color={method === m ? antd.primary : antd.textTertiary}
                />
                <Text
                  style={[
                    styles.methodText,
                    method === m && styles.methodTextActive,
                  ]}
                >
                  {m === 'cash' ? 'Cash' : 'Card / Other'}
                </Text>
              </View>
            </TouchableRipple>
          ))}
        </View>

        {method === 'cash' ? (
          <>
            <View style={styles.tenderDisplay}>
              <Text variant="labelSmall" style={{ color: antd.textTertiary }}>
                Cash received
              </Text>
              <Text variant="headlineSmall" style={styles.tenderValue}>
                {formatMoney(tenderedCents)}
              </Text>
            </View>
            <View style={styles.quickRow}>
              {QUICK_TENDER.map((cents) => (
                <TouchableRipple
                  key={cents}
                  onPress={() => setTendered(String(cents))}
                  style={styles.quickBtn}
                  borderless
                >
                  <Text style={styles.quickText}>{formatMoney(cents)}</Text>
                </TouchableRipple>
              ))}
              <TouchableRipple
                onPress={() => setTendered(String(totals.totalAmount))}
                style={[styles.quickBtn, styles.quickExact]}
                borderless
              >
                <Text style={[styles.quickText, { color: antd.primary }]}>
                  Exact
                </Text>
              </TouchableRipple>
            </View>
            <NumPad onDigit={pressDigit} onBackspace={backspace} onClear={() => setTendered('')} />
            <View style={styles.changeRow}>
              <Text variant="titleSmall" style={{ color: antd.textSecondary }}>
                Change
              </Text>
              <Text
                variant="titleMedium"
                style={{
                  color: change >= 0 ? antd.success : antd.error,
                  fontWeight: '700',
                }}
              >
                {change >= 0
                  ? formatMoney(change)
                  : `${formatMoney(-change)} short`}
              </Text>
            </View>
          </>
        ) : (
          <View style={styles.cardNote}>
            <MaterialCommunityIcons
              name="credit-card-check-outline"
              size={32}
              color={antd.primary}
            />
            <Text variant="bodyMedium" style={{ color: antd.textSecondary, textAlign: 'center' }}>
              Take the card payment on your terminal, then confirm here to
              record it{online ? '' : ' (it will sync once you are back online)'}.
            </Text>
          </View>
        )}

        <Button
          mode="contained"
          icon="check"
          buttonColor={antd.success}
          disabled={!canConfirm}
          onPress={confirmPayment}
          style={styles.confirmBtn}
          contentStyle={{ height: 52 }}
          labelStyle={{ fontSize: 16, fontWeight: '700' }}
        >
          Confirm Payment
        </Button>
      </View>
    </View>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <View style={styles.totalsRow}>
      <Text
        variant={bold ? 'titleMedium' : 'bodySmall'}
        style={{ color: bold ? antd.text : antd.textSecondary, fontWeight: bold ? '700' : '400' }}
      >
        {label}
      </Text>
      <Text
        variant={bold ? 'titleMedium' : 'bodySmall'}
        style={{ color: antd.text, fontWeight: bold ? '700' : '400' }}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, flexDirection: 'row', backgroundColor: antd.bgLayout },
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    backgroundColor: antd.bgLayout,
  },
  summary: {
    flex: 1,
    margin: 16,
    marginRight: 8,
    backgroundColor: antd.bgContainer,
    borderRadius: RADIUS,
    borderWidth: 1,
    borderColor: antd.split,
    overflow: 'hidden',
  },
  summaryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 6,
    gap: 4,
  },
  summaryTitle: { color: antd.text, fontWeight: '600' },
  summaryLine: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  lineName: { color: antd.text, flex: 1 },
  lineAmount: { color: antd.text, fontWeight: '600' },
  summaryTotals: {
    borderTopWidth: 1,
    borderTopColor: antd.split,
    padding: 16,
    gap: 4,
  },
  totalsRow: { flexDirection: 'row', justifyContent: 'space-between' },
  tender: {
    width: 380,
    margin: 16,
    marginLeft: 8,
    gap: 12,
  },
  payableCard: {
    backgroundColor: antd.bgContainer,
    borderRadius: RADIUS,
    borderWidth: 1,
    borderColor: antd.split,
    padding: 14,
  },
  payable: { color: antd.success, fontWeight: '800' },
  methodTabs: { flexDirection: 'row', gap: 8 },
  methodTab: {
    flex: 1,
    borderRadius: RADIUS,
    borderWidth: 1,
    borderColor: antd.border,
    backgroundColor: antd.bgContainer,
    paddingVertical: 10,
  },
  methodTabActive: { borderColor: antd.primary, backgroundColor: antd.primaryBg },
  methodInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  methodText: { color: antd.textSecondary, fontWeight: '600' },
  methodTextActive: { color: antd.primary },
  tenderDisplay: {
    backgroundColor: antd.bgContainer,
    borderRadius: RADIUS,
    borderWidth: 1,
    borderColor: antd.border,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  tenderValue: { color: antd.text, fontWeight: '700' },
  quickRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  quickBtn: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: RADIUS,
    borderWidth: 1,
    borderColor: antd.border,
    backgroundColor: antd.bgContainer,
  },
  quickExact: { borderColor: antd.primary, backgroundColor: antd.primaryBg },
  quickText: { fontSize: 13, fontWeight: '600', color: antd.textSecondary },
  changeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: antd.bgContainer,
    borderRadius: RADIUS,
    borderWidth: 1,
    borderColor: antd.split,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  cardNote: {
    alignItems: 'center',
    gap: 12,
    backgroundColor: antd.bgContainer,
    borderRadius: RADIUS,
    borderWidth: 1,
    borderColor: antd.split,
    padding: 24,
  },
  confirmBtn: { borderRadius: RADIUS, marginTop: 'auto' },
});
