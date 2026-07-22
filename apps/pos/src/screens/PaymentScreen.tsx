import React, { useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { Button, Divider, IconButton, Text, TextInput, TouchableRipple } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { antd, RADIUS } from '../theme';
import { useApp } from '../state/AppContext';
import { useCart } from '../state/CartContext';
import * as ordersRepo from '../db/ordersRepo';
import * as mutationsRepo from '../db/mutationsRepo';
import * as tabsRepo from '../db/tabsRepo';
import { NumPad } from '../components/NumPad';
import { syncEngine } from '../sync/syncEngine';
import { formatMoney, parseMoney } from '../utils/money';
import { lineUnitPrice } from '../state/cartOps';
import { printReceipt } from '../printing/printerService';
import type { PaymentMethod } from '../types';
import type { ScreenName } from '../navigation';

const QUICK_TENDER = [500, 1000, 2000, 5000, 10000];
const TIP_PRESETS = [0, 10, 15, 20];

// Store Credit and Other are temporarily hidden from the tender picker (not removed —
// PaymentMethod still supports them server-side); re-add here when they're ready.
const METHODS: { value: PaymentMethod; label: string; icon: string }[] = [
  { value: 'cash', label: 'Cash', icon: 'cash' },
  { value: 'card', label: 'Card', icon: 'credit-card-outline' },
  { value: 'gift_card', label: 'Gift Card', icon: 'gift-outline' },
];

interface Props {
  onNavigate: (screen: ScreenName) => void;
  onCompleted: (message: string) => void;
}

/** Cash / card tender. Works fully offline: the paid order joins the sync queue. */
export function PaymentScreen({ onNavigate, onCompleted }: Props) {
  const { settings, online, syncNow } = useApp();
  const cart = useCart();
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [tendered, setTendered] = useState(''); // digits, cents
  const [tipPreset, setTipPreset] = useState<number | 'custom' | null>(0);
  const [customTip, setCustomTip] = useState(''); // dollar string while editing
  const [serviceCharge, setServiceCharge] = useState(false);
  const [redeemPoints, setRedeemPoints] = useState(false);
  const totals = cart.totals(
    settings.taxRateBps,
    settings.serviceChargeBps,
    serviceCharge,
  );
  // P7-001: a single finger tap fires onPress once, but a double-tap on a tablet
  // screen can fire both before the navigation below unmounts. carry out two
  // saveOrder→syncNow runs, generating two newId() orders on the server. Guard
  // the path with a one-shot flag.
  const [confirming, setConfirming] = useState(false);

  const tenderedCents = useMemo(
    () => (tendered ? Number.parseInt(tendered, 10) : 0),
    [tendered],
  );
  const tipAmount =
    tipPreset === 'custom'
      ? parseMoney(customTip)
      : Math.round((totals.totalAmount * (tipPreset ?? 0)) / 100);
  const serviceChargeAmount = totals.serviceChargeAmount;
  const availablePoints = cart.customer?.loyaltyPoints ?? 0;
  const preRedemptionTotal = totals.totalAmount + tipAmount;
  const redemptionAmount = redeemPoints
    ? Math.min(availablePoints, preRedemptionTotal)
    : 0;
  const grandTotal = preRedemptionTotal - redemptionAmount;
  const change = tenderedCents - grandTotal;
  const canConfirm =
    !confirming &&
    cart.lines.length > 0 &&
    (method !== 'cash' || tenderedCents >= grandTotal);

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
      tenderedAmount: method === 'cash' ? tenderedCents : grandTotal,
      changeAmount: method === 'cash' ? Math.max(change, 0) : 0,
      tipAmount,
      serviceChargeAmount,
      loyaltyPointsRedeemed: redemptionAmount,
      taxAmount: totals.taxAmount,
      totalAmount: totals.totalAmount,
    });
    // `buildOrder` calls `newId()` internally. Two concurrent invocations
    // (e.g. a double-tap that fires both onPress before unmount) would mint
    // two distinct client-order ids and the queue would push both. The
    // `confirming` flag short-circuits the second tap before that happens.
    // We intentionally do NOT reset `confirming`: the screen unmounts via
    // onNavigate below and remounting the next sale gets a fresh state.
    if (cart.tabOrderId) {
      // Settling an open tab: the order already exists server-side, so this
      // is an append (for anything rung in this last round) followed by a
      // tender — never a second create.
      tabsRepo.settleTab(order, cart.tabDelta(), {
        paymentMethod: method,
        tenderedAmount: order.tenderedAmount,
        changeAmount: order.changeAmount,
        tipAmount,
      });
    } else {
      ordersRepo.saveOrder(order);
      mutationsRepo.enqueue(order.id, 'create', {});
    }
    syncEngine.refreshCounts();
    if (settings.printerEnabled && settings.printerAutoReceipt) {
      void printReceipt(order, settings, settings.locationName).then((result) => {
        if (!result.ok) Alert.alert('Print failed', result.error);
      });
    }
    setTendered('');
    setTipPreset(0);
    setCustomTip('');
    setServiceCharge(false);
    setRedeemPoints(false);
    if (online) syncNow();

    if (cart.splitPlan) {
      // Capture before advancing — advanceSplitCheck() bumps paidCount internally.
      const { paidCount, total } = cart.splitPlan;
      const more = cart.advanceSplitCheck();
      if (more) {
        // Stay on this screen: `lines` now holds the next check, so the recap
        // and totals above re-render for it on the next paint. Re-arm the
        // double-tap guard since we're not unmounting to reset it for us.
        setConfirming(false);
        onCompleted(`Check ${paidCount + 1} of ${total} paid — ${formatMoney(grandTotal)} ${method}.`);
        return;
      }
      cart.clear();
      onCompleted(`All ${total} checks paid.`);
      onNavigate('home');
      return;
    }

    cart.clear();
    onCompleted(
      online
        ? `Payment recorded — ${formatMoney(grandTotal)} ${method}. Syncing…`
        : `Payment recorded offline — ${formatMoney(grandTotal)} ${method}. Will sync when online.`,
    );
    onNavigate('home');
  };

  const handleBack = () => {
    if (cart.splitPlan) {
      Alert.alert(
        'Cancel Split Pay?',
        'The remaining checks will be merged back into one cart.',
        [
          { text: 'Keep Splitting', style: 'cancel' },
          {
            text: 'Cancel Split',
            style: 'destructive',
            onPress: () => {
              cart.cancelSplit();
              onNavigate('home');
            },
          },
        ],
      );
      return;
    }
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
            onPress={handleBack}
            textColor={antd.textSecondary}
          >
            Back
          </Button>
          <Text variant="titleMedium" style={styles.summaryTitle}>
            {cart.customer?.name ?? 'Walk-in customer'}
            {cart.table ? ` · Table ${cart.table.name}` : ''}
          </Text>
          {cart.splitPlan && (
            <Text variant="labelMedium" style={styles.splitBadge}>
              Check {cart.splitPlan.paidCount + 1} of {cart.splitPlan.total}
            </Text>
          )}
          <IconButton
            icon="printer-outline"
            size={20}
            iconColor={antd.primary}
            onPress={async () => {
              const result = await printReceipt(
                cart.buildOrder(settings.taxRateBps),
                settings,
                settings.locationName,
              );
              if (!result.ok) Alert.alert('Print failed', result.error);
            }}
          />
        </View>
        <Divider />
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 8 }}>
          {cart.lines.map((line) => (
            <View key={line.product.id} style={styles.summaryLine}>
              <Text variant="bodyMedium" style={styles.lineName} numberOfLines={1}>
                {line.quantity} × {line.product.name}
              </Text>
              <Text variant="bodyMedium" style={styles.lineAmount}>
                {formatMoney(lineUnitPrice(line) * line.quantity)}
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
          {serviceChargeAmount > 0 && (
            <Row
              label={`Service Charge (${(settings.serviceChargeBps / 100).toFixed(0)}%)`}
              value={formatMoney(serviceChargeAmount)}
            />
          )}
          <Row label="Tax" value={formatMoney(totals.taxAmount)} />
          {tipAmount > 0 && <Row label="Tip" value={formatMoney(tipAmount)} />}
          {redemptionAmount > 0 && (
            <Row
              label="Loyalty Points Redeemed"
              value={`-${formatMoney(redemptionAmount)}`}
            />
          )}
          <Divider style={{ marginVertical: 6 }} />
          <Row label="Grand Total" value={formatMoney(grandTotal)} bold />
        </View>
      </View>

      {/* Tender */}
      <View style={styles.tender}>
        {/* Fixed header: Payable Amount + Change stay visible no matter how far the
            controls below are scrolled, so the cashier always sees what's owed. */}
        <View style={styles.payableCard}>
          <Text variant="labelMedium" style={{ color: antd.textSecondary }}>
            Payable Amount
          </Text>
          <Text variant="headlineMedium" style={styles.payable}>
            {formatMoney(grandTotal)}
          </Text>
          {method === 'cash' && (
            <View style={styles.changeRowInline}>
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
          )}
        </View>

        <View style={styles.tenderBody}>
        {settings.serviceChargeBps > 0 && (
          <TouchableRipple
            onPress={() => setServiceCharge((prev) => !prev)}
            style={[
              styles.serviceChargeToggle,
              serviceCharge && styles.serviceChargeToggleActive,
            ]}
            borderless
          >
            <View style={styles.serviceChargeRow}>
              <MaterialCommunityIcons
                name={serviceCharge ? 'checkbox-marked' : 'checkbox-blank-outline'}
                size={20}
                color={serviceCharge ? antd.primary : antd.textTertiary}
              />
              <Text
                style={[
                  styles.serviceChargeText,
                  serviceCharge && styles.serviceChargeTextActive,
                ]}
              >
                Add Service Charge ({(settings.serviceChargeBps / 100).toFixed(0)}%)
              </Text>
            </View>
          </TouchableRipple>
        )}

        {availablePoints > 0 && (
          <TouchableRipple
            onPress={() => setRedeemPoints((prev) => !prev)}
            style={[
              styles.serviceChargeToggle,
              redeemPoints && styles.serviceChargeToggleActive,
            ]}
            borderless
          >
            <View style={styles.serviceChargeRow}>
              <MaterialCommunityIcons
                name={redeemPoints ? 'checkbox-marked' : 'checkbox-blank-outline'}
                size={20}
                color={redeemPoints ? antd.primary : antd.textTertiary}
              />
              <Text
                style={[
                  styles.serviceChargeText,
                  redeemPoints && styles.serviceChargeTextActive,
                ]}
              >
                Redeem Loyalty Points ({formatMoney(availablePoints)} available)
              </Text>
            </View>
          </TouchableRipple>
        )}

        <View style={styles.tipRow}>
          {TIP_PRESETS.map((pct) => (
            <TouchableRipple
              key={pct}
              onPress={() => setTipPreset(pct)}
              style={[styles.tipChip, tipPreset === pct && styles.tipChipActive]}
              borderless
            >
              <Text
                style={[
                  styles.tipChipText,
                  tipPreset === pct && styles.tipChipTextActive,
                ]}
              >
                {pct === 0 ? 'No tip' : `${pct}%`}
              </Text>
            </TouchableRipple>
          ))}
          <TouchableRipple
            onPress={() => setTipPreset('custom')}
            style={[styles.tipChip, tipPreset === 'custom' && styles.tipChipActive]}
            borderless
          >
            <Text
              style={[
                styles.tipChipText,
                tipPreset === 'custom' && styles.tipChipTextActive,
              ]}
            >
              Custom
            </Text>
          </TouchableRipple>
        </View>
        {tipPreset === 'custom' && (
          <TextInput
            mode="outlined"
            keyboardType="decimal-pad"
            placeholder="Tip amount"
            value={customTip}
            onChangeText={setCustomTip}
            left={<TextInput.Icon icon="currency-usd" />}
            style={{ backgroundColor: antd.bgContainer }}
            outlineStyle={{ borderRadius: RADIUS }}
          />
        )}

        <View style={styles.methodTabs}>
          {METHODS.map((m) => (
            <TouchableRipple
              key={m.value}
              onPress={() => setMethod(m.value)}
              style={[
                styles.methodTab,
                method === m.value && styles.methodTabActive,
              ]}
              borderless
            >
              <View style={styles.methodInner}>
                <MaterialCommunityIcons
                  name={m.icon as keyof typeof MaterialCommunityIcons.glyphMap}
                  size={18}
                  color={method === m.value ? antd.primary : antd.textTertiary}
                />
                <Text
                  style={[
                    styles.methodText,
                    method === m.value && styles.methodTextActive,
                  ]}
                >
                  {m.label}
                </Text>
              </View>
            </TouchableRipple>
          ))}
        </View>

        {method === 'cash' ? (
          <>
            <View style={styles.tenderDisplay}>
              <View style={{ flex: 1 }}>
                <Text variant="labelSmall" style={{ color: antd.textTertiary }}>
                  Cash received
                </Text>
                <Text variant="headlineSmall" style={styles.tenderValue}>
                  {formatMoney(tenderedCents)}
                </Text>
              </View>
              <Button
                mode="text"
                compact
                onPress={() => setTendered('')}
                disabled={!tendered}
                textColor={antd.error}
              >
                Clear
              </Button>
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
                onPress={() => setTendered(String(grandTotal))}
                style={[styles.quickBtn, styles.quickExact]}
                borderless
              >
                <Text style={[styles.quickText, { color: antd.primary }]}>
                  Exact
                </Text>
              </TouchableRipple>
            </View>
            <NumPad
              onDigit={pressDigit}
              onBackspace={backspace}
              onClear={() => setTendered('')}
            />
          </>
        ) : (
          <View style={styles.cardNote}>
            <MaterialCommunityIcons
              name="credit-card-check-outline"
              size={32}
              color={antd.primary}
            />
            <Text variant="bodyMedium" style={{ color: antd.textSecondary, textAlign: 'center' }}>
              {method === 'card'
                ? 'Take the card payment on your terminal, '
                : method === 'gift_card'
                  ? 'Redeem the gift card, '
                  : method === 'store_credit'
                    ? 'Apply the store credit, '
                    : 'Collect the payment, '}
              then confirm here to record it
              {online ? '' : ' (it will sync once you are back online)'}.
            </Text>
          </View>
        )}
        </View>

        <Button
          mode="contained"
          icon="check"
          buttonColor={antd.success}
          disabled={!canConfirm}
          onPress={confirmPayment}
          style={styles.confirmBtn}
          contentStyle={{ height: 40 }}
          labelStyle={{ fontSize: 14, fontWeight: '700' }}
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
  splitBadge: {
    color: antd.primary,
    fontWeight: '700',
    backgroundColor: antd.primaryBg,
    borderRadius: RADIUS,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
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
    gap: 8,
  },
  tenderBody: { gap: 8 },
  payableCard: {
    backgroundColor: antd.bgContainer,
    borderRadius: RADIUS,
    borderWidth: 1,
    borderColor: antd.split,
    padding: 10,
    gap: 4,
  },
  payable: { color: antd.success, fontWeight: '800', fontSize: 22, lineHeight: 26 },
  changeRowInline: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: antd.split,
    paddingTop: 4,
  },
  methodTabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  methodTab: {
    flexBasis: '31%',
    flexGrow: 1,
    borderRadius: RADIUS,
    borderWidth: 1,
    borderColor: antd.border,
    backgroundColor: antd.bgContainer,
    paddingVertical: 6,
  },
  methodTabActive: { borderColor: antd.primary, backgroundColor: antd.primaryBg },
  methodInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  methodText: { color: antd.textSecondary, fontWeight: '600', fontSize: 12 },
  methodTextActive: { color: antd.primary },
  serviceChargeToggle: {
    borderRadius: RADIUS,
    borderWidth: 1,
    borderColor: antd.border,
    backgroundColor: antd.bgContainer,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  serviceChargeToggleActive: { borderColor: antd.primary, backgroundColor: antd.primaryBg },
  serviceChargeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  serviceChargeText: { color: antd.textSecondary, fontWeight: '600', fontSize: 12.5 },
  serviceChargeTextActive: { color: antd.primary },
  tipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tipChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: RADIUS,
    borderWidth: 1,
    borderColor: antd.border,
    backgroundColor: antd.bgContainer,
  },
  tipChipActive: { borderColor: antd.primary, backgroundColor: antd.primaryBg },
  tipChipText: { fontSize: 12.5, fontWeight: '600', color: antd.textSecondary },
  tipChipTextActive: { color: antd.primary },
  tenderDisplay: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: antd.bgContainer,
    borderRadius: RADIUS,
    borderWidth: 1,
    borderColor: antd.border,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  tenderValue: { color: antd.text, fontWeight: '700', fontSize: 18 },
  quickRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  quickBtn: {
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: RADIUS,
    borderWidth: 1,
    borderColor: antd.border,
    backgroundColor: antd.bgContainer,
  },
  quickExact: { borderColor: antd.primary, backgroundColor: antd.primaryBg },
  quickText: { fontSize: 12.5, fontWeight: '600', color: antd.textSecondary },
  cardNote: {
    alignItems: 'center',
    gap: 8,
    backgroundColor: antd.bgContainer,
    borderRadius: RADIUS,
    borderWidth: 1,
    borderColor: antd.split,
    padding: 16,
  },
  confirmBtn: { borderRadius: RADIUS },
});
