import React, { useEffect, useRef, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { Button, Divider, IconButton, Text, TouchableRipple } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { antd, RADIUS } from '../theme';
import { formatMoney } from '../utils/money';
import { useApp } from '../state/AppContext';
import { useEmployee } from '../state/EmployeeContext';
import { useCart } from '../state/CartContext';
import * as ordersRepo from '../db/ordersRepo';
import * as tabsRepo from '../db/tabsRepo';
import { syncEngine } from '../sync/syncEngine';
import { printKitchenTicketsByStation, type StationPrintResult } from '../printing/printerService';
import { printQueue } from '../printing/printQueueService';
import { DiscountDialog } from './DiscountDialog';
import { PriceOverrideDialog } from './PriceOverrideDialog';
import { ItemCustomizeDialog } from './ItemCustomizeDialog';
import { CoursesControl } from './CoursesControl';
import { SplitCheckDialog } from './SplitCheckDialog';
import { lineUnitPrice } from '../state/cartOps';
import { COURSE_LABELS, type CartLine } from '../types';

interface Props {
  onProceed: () => void;
  onSelectCustomer: () => void;
}

/** Failures only — a fully successful print needs no summary shown to the cashier. */
function summarizeFailures(results: StationPrintResult[]): string | null {
  const failed = results.filter((r) => !r.result.ok);
  if (failed.length === 0) return null;
  return failed.map((r) => `${r.stationName}: ${r.result.error ?? 'failed'}`).join('\n');
}

/** Right-hand order panel: line items, totals, and the three placement actions
 *  (Save / Send to kitchen / Pay). */
export function CartPanel({ onProceed, onSelectCustomer }: Props) {
  const { settings, online, syncNow } = useApp();
  const { employee } = useEmployee();
  const cart = useCart();
  const t = cart.totals(settings.taxRateBps);
  const [discountOpen, setDiscountOpen] = useState(false);
  const [editingLine, setEditingLine] = useState<CartLine | null>(null);
  const [splitOpen, setSplitOpen] = useState(false);
  const [overridingLine, setOverridingLine] = useState<CartLine | null>(null);

  // One-shot latch for the order-placing actions. `cart.lines` is read from the
  // render closure, so three taps landing in the same frame all see a non-empty
  // cart and each mint a fresh order id — three tickets on the pass for one
  // order. The server's clientOrderId idempotency can't dedupe them because the
  // ids genuinely differ, so the guard has to live here. Clearing the cart
  // releases it, which is also what readies the next order.
  const submitting = useRef(false);
  useEffect(() => {
    if (cart.lines.length === 0) submitting.current = false;
  }, [cart.lines.length]);

  // Callers check their own preconditions first, so a no-op tap never latches.
  const claimSubmit = (): boolean => {
    if (submitting.current) return false;
    submitting.current = true;
    return true;
  };

  // Quantities already fired to the kitchen can't be stepped back down here —
  // that's a void, which is manager-gated and not part of this flow.
  const firedQty = new Map(cart.tabBaseline.map((l) => [l.id, l.quantity]));

  const printCurrentTicket = async () => {
    if (cart.lines.length === 0) return;
    const results = await printKitchenTicketsByStation(
      cart.buildOrder(settings.taxRateBps),
      settings,
      employee?.displayName ?? null,
      settings.locationName,
    );
    const failures = summarizeFailures(results);
    if (failures) Alert.alert('Print failed', failures);
  };

  /**
   * Park the order. A saved order is explicitly *not* placed: it stays local
   * (status 'held'), is never queued to the server, and — critically — never
   * prints. An earlier build fired the kitchen ticket from here when
   * `printerAutoKitchen` was on, which meant "hold" silently cooked the food.
   */
  const saveOrder = () => {
    if (cart.lines.length === 0 || !claimSubmit()) return;
    ordersRepo.saveOrder(cart.buildOrder(settings.taxRateBps));
    syncEngine.refreshCounts();
    cart.clear();
  };

  /**
   * Fire to the kitchen and leave the order open and unpaid. Works for every
   * order type — a pickup or delivery ticket needs to reach the line without
   * being tendered first, exactly like a seated table does. The table, when
   * there is one, just rides along on the order.
   */
  const sendToKitchen = () => {
    if (cart.lines.length === 0 || !claimSubmit()) return;
    const order = cart.buildOrder(settings.taxRateBps);
    tabsRepo.openTab(order);
    syncEngine.refreshCounts();
    if (online) void syncNow();
    // Firing an order is what the auto-print setting was always meant to mean;
    // it used to hang off Hold. Registers that print over the backend's MQTT
    // pipeline leave this off — this is the direct-Bluetooth path. The order is
    // already saved above; enqueuing (not printing inline) means a jammed or
    // offline printer can never block or lose the ticket — it retries from the
    // durable queue and surfaces as a badge instead of a dead-end Alert.
    if (settings.printerEnabled && settings.printerAutoKitchen) {
      printQueue.enqueueOrder(
        order,
        settings,
        employee?.displayName ?? null,
        settings.locationName,
      );
    }
    cart.clear();
  };

  const saveToTab = () => {
    // Appending is the most damaging action to double-fire: each repeat queues
    // the same delta again, so the tab gains the items twice and the pass gets
    // two tickets for one send.
    if (!cart.tabOrderId || cart.tabDelta().length === 0 || !claimSubmit()) return;
    tabsRepo.appendToTab(cart.buildOrder(settings.taxRateBps), cart.tabDelta());
    syncEngine.refreshCounts();
    if (online) void syncNow();
    cart.clear();
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text variant="titleSmall" style={styles.headerTitle}>
            {cart.customer ? cart.customer.name : 'Walk-in customer'}
          </Text>
          <Text variant="labelSmall" style={styles.headerSub}>
            {cart.tabOrderId && cart.table
              ? `Open tab · Table ${cart.table.name}`
              : cart.table
              ? `Table ${cart.table.name}${cart.guests ? ` · ${cart.guests} guests` : ''}`
              : cart.orderType === 'dine_in'
                ? 'Dine in'
                : cart.orderType === 'pickup'
                  ? 'Pickup'
                  : 'Delivery'}
          </Text>
        </View>
        <IconButton
          icon="printer-outline"
          size={20}
          disabled={cart.lines.length === 0}
          onPress={printCurrentTicket}
          iconColor={antd.primary}
        />
        <IconButton
          icon="account-plus-outline"
          size={20}
          onPress={onSelectCustomer}
          iconColor={antd.primary}
        />
      </View>
      <Divider />

      <ScrollView style={styles.items} contentContainerStyle={{ paddingVertical: 4 }}>
        {cart.lines.length === 0 ? (
          <View style={styles.empty}>
            <MaterialCommunityIcons
              name="cart-outline"
              size={40}
              color={antd.textQuaternary}
            />
            <Text variant="bodySmall" style={styles.emptyText}>
              Tap products to add them to the order
            </Text>
          </View>
        ) : (
          cart.lines.map((line) => (
            <TouchableRipple
              key={line.id}
              onPress={() => setEditingLine(line)}
              style={styles.line}
            >
              {/* Two rows rather than one: a single row can't hold a 48dp-class
                  stepper in a 340pt panel without squeezing the item name to a
                  few characters. Name/total read on top, controls sit below. */}
              <View style={styles.lineInner}>
                <View style={styles.lineTopRow}>
                  <Text variant="bodyMedium" numberOfLines={1} style={styles.lineName}>
                    {line.product.name}
                  </Text>
                  <Text variant="bodyMedium" style={styles.lineTotal}>
                    {formatMoney(lineUnitPrice(line) * line.quantity)}
                  </Text>
                </View>
                <View style={styles.lineBottomRow}>
                  <Text variant="labelSmall" numberOfLines={1} style={styles.lineUnit}>
                    {line.course ? `${COURSE_LABELS[line.course]} · ` : ''}
                    {formatMoney(lineUnitPrice(line))} each
                    {line.priceOverride !== undefined ? ' (overridden)' : ''}
                    {line.selectedModifiers?.length
                      ? ` · ${line.selectedModifiers.map((m) => m.name).join(', ')}`
                      : ''}
                    {line.notes ? ` · ${line.notes}` : ''}
                  </Text>
                  <IconButton
                    icon="cash-edit"
                    size={18}
                    style={styles.overrideBtn}
                    iconColor={
                      line.priceOverride !== undefined ? antd.primary : antd.textTertiary
                    }
                    onPress={() => setOverridingLine(line)}
                  />
                  <View style={styles.stepper}>
                    <IconButton
                      icon="minus"
                      size={18}
                      style={styles.stepBtn}
                      disabled={line.quantity <= (firedQty.get(line.id) ?? 0)}
                      onPress={() => cart.setQuantity(line.id, line.quantity - 1)}
                    />
                    <Text style={styles.qty}>{line.quantity}</Text>
                    <IconButton
                      icon="plus"
                      size={18}
                      style={styles.stepBtn}
                      onPress={() => cart.setQuantity(line.id, line.quantity + 1)}
                    />
                  </View>
                </View>
              </View>
            </TouchableRipple>
          ))
        )}
      </ScrollView>

      <View style={styles.footer}>
        {/* Coursing only makes sense for a seated party. */}
        {cart.table && (
          <CoursesControl
            fireMode={cart.fireMode}
            onFireModeChange={cart.setFireMode}
            activeCourse={cart.activeCourse}
            onActiveCourseChange={cart.setActiveCourse}
          />
        )}
        <View style={styles.discountRow}>
          <Button
            mode="text"
            compact
            icon="tag-outline"
            onPress={() => setDiscountOpen(true)}
            textColor={antd.primary}
          >
            {cart.discount ? cart.discount.name : 'Add Discount / Coupon'}
          </Button>
          {cart.discount && (
            <IconButton
              icon="close"
              size={14}
              style={styles.stepBtn}
              iconColor={antd.textTertiary}
              onPress={() => cart.setDiscount(null)}
            />
          )}
        </View>
        {!cart.tabOrderId && cart.lines.length > 0 && (
          <Button
            mode="text"
            compact
            icon="call-split"
            disabled={Boolean(cart.discount)}
            onPress={() => setSplitOpen(true)}
            textColor={antd.primary}
            style={{ alignSelf: 'flex-start' }}
          >
            {cart.discount ? 'Split Check (remove discount first)' : 'Split Check'}
          </Button>
        )}
        <View style={styles.totalRow}>
          <Text variant="bodySmall" style={styles.totalLabel}>Subtotal</Text>
          <Text variant="bodySmall" style={styles.totalValue}>
            {formatMoney(t.subtotal)}
          </Text>
        </View>
        {t.discountAmount > 0 && (
          <View style={styles.totalRow}>
            <Text variant="bodySmall" style={{ color: antd.success }}>Discount</Text>
            <Text variant="bodySmall" style={{ color: antd.success }}>
              -{formatMoney(t.discountAmount)}
            </Text>
          </View>
        )}
        <View style={styles.totalRow}>
          <Text variant="bodySmall" style={styles.totalLabel}>Tax</Text>
          <Text variant="bodySmall" style={styles.totalValue}>
            {formatMoney(t.taxAmount)}
          </Text>
        </View>
        <Divider style={{ marginVertical: 6 }} />
        <View style={styles.totalRow}>
          <Text variant="titleMedium" style={styles.payableLabel}>
            Payable Amount
          </Text>
          <Text variant="titleMedium" style={styles.payableValue}>
            {formatMoney(t.totalAmount)}
          </Text>
        </View>
        {/* Secondary actions sit on their own row so payment can be a single
            full-width primary at the bottom — the one action that shouldn't
            have to compete for the cashier's eye. */}
        <View style={styles.actions}>
          {cart.tabOrderId ? (
            <Button
              mode="outlined"
              icon="content-save-outline"
              onPress={saveToTab}
              disabled={cart.tabDelta().length === 0}
              style={styles.tabBtn}
              textColor={antd.primary}
            >
              Save to Tab
            </Button>
          ) : (
            <>
              <Button
                mode="outlined"
                icon="content-save-outline"
                onPress={saveOrder}
                disabled={cart.lines.length === 0}
                style={styles.holdBtn}
                textColor={antd.warning}
              >
                Save Order
              </Button>
              <Button
                mode="outlined"
                icon="chef-hat"
                onPress={sendToKitchen}
                disabled={cart.lines.length === 0}
                style={styles.tabBtn}
                textColor={antd.primary}
              >
                Send
              </Button>
            </>
          )}
        </View>
        <Button
          mode="contained"
          icon="credit-card-outline"
          onPress={onProceed}
          disabled={cart.lines.length === 0}
          style={styles.proceedBtn}
          contentStyle={styles.proceedContent}
          buttonColor={antd.success}
        >
          {`Pay ${formatMoney(t.totalAmount)}`}
        </Button>
      </View>

      <DiscountDialog
        visible={discountOpen}
        onDismiss={() => setDiscountOpen(false)}
        selectedId={cart.discount?.id ?? null}
        onApply={cart.setDiscount}
      />

      <ItemCustomizeDialog
        visible={editingLine !== null}
        product={editingLine?.product ?? null}
        initialQuantity={editingLine?.quantity}
        initialNotes={editingLine?.notes}
        initialCourse={editingLine?.course}
        initialSelectedModifiers={editingLine?.selectedModifiers}
        showCourses={cart.fireMode === 'by_course'}
        mode="edit"
        onDismiss={() => setEditingLine(null)}
        onConfirm={(product, quantity, notes, course, selectedModifiers) => {
          // Pass the line's original course so a course change re-keys the
          // Addressed by line id, so editing one Spicy line never touches the
          // Regular line of the same dish sitting beside it.
          if (!editingLine) return;
          cart.updateLine(
            editingLine.id,
            quantity,
            notes || undefined,
            course,
            selectedModifiers,
          );
        }}
      />

      <PriceOverrideDialog
        visible={overridingLine !== null}
        onDismiss={() => setOverridingLine(null)}
        lineName={overridingLine?.product.name ?? ''}
        currentPrice={overridingLine ? lineUnitPrice(overridingLine) : 0}
        currentOverride={overridingLine?.priceOverride}
        currentReason={overridingLine?.priceOverrideReason}
        onApply={(newPrice, reason) => {
          if (!overridingLine) return;
          cart.setPriceOverride(
            overridingLine.id,
            newPrice ?? undefined,
            newPrice !== null ? reason : undefined,
          );
        }}
      />

      <SplitCheckDialog
        visible={splitOpen}
        lines={cart.lines}
        onDismiss={() => setSplitOpen(false)}
        onConfirm={(groups) => {
          cart.startSplitChecks(groups);
          onProceed();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: 340,
    backgroundColor: antd.bgContainer,
    borderLeftWidth: 1,
    borderLeftColor: antd.split,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 16,
    paddingRight: 4,
    paddingVertical: 8,
  },
  headerTitle: { color: antd.text, fontWeight: '600' },
  headerSub: { color: antd.textTertiary },
  items: { flex: 1, paddingHorizontal: 12 },
  empty: { alignItems: 'center', paddingTop: 60, gap: 10 },
  emptyText: { color: antd.textTertiary },
  line: {
    borderBottomWidth: 1,
    borderBottomColor: antd.split,
  },
  lineInner: {
    paddingVertical: 8,
    gap: 4,
  },
  lineTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  lineBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  lineName: { flex: 1, color: antd.text, fontWeight: '500' },
  lineUnit: { flex: 1, color: antd.textTertiary },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: antd.border,
    borderRadius: RADIUS,
  },
  // 44pt square — Android's touch minimum is 48dp and these sit inside a
  // bordered group that extends the visual target past the icon itself.
  stepBtn: { margin: 0, width: 44, height: 44 },
  overrideBtn: { margin: 0, width: 40, height: 40 },
  qty: {
    minWidth: 28,
    textAlign: 'center',
    color: antd.text,
    fontWeight: '700',
    fontSize: 15,
  },
  lineTotal: { textAlign: 'right', color: antd.text, fontWeight: '700' },
  footer: {
    borderTopWidth: 1,
    borderTopColor: antd.split,
    padding: 16,
    gap: 4,
    backgroundColor: antd.bgContainer,
  },
  discountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between' },
  totalLabel: { color: antd.textSecondary },
  totalValue: { color: antd.text },
  payableLabel: { color: antd.text, fontWeight: '700' },
  payableValue: { color: antd.text, fontWeight: '700' },
  actions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  holdBtn: {
    flex: 1,
    borderRadius: RADIUS,
    borderColor: antd.warning,
  },
  tabBtn: {
    flex: 1,
    borderRadius: RADIUS,
    borderColor: antd.primary,
  },
  proceedBtn: { borderRadius: RADIUS, marginTop: 10 },
  // 52pt — the highest-value target in the app deserves to be unmissable.
  proceedContent: { height: 52 },
});
