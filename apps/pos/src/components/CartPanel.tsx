import React, { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, Divider, IconButton, Text, TouchableRipple } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { antd, RADIUS } from '../theme';
import { formatMoney } from '../utils/money';
import { useApp } from '../state/AppContext';
import { useCart } from '../state/CartContext';
import * as ordersRepo from '../db/ordersRepo';
import { syncEngine } from '../sync/syncEngine';
import { DiscountDialog } from './DiscountDialog';
import { ItemCustomizeDialog } from './ItemCustomizeDialog';
import type { CartLine } from '../types';

interface Props {
  onProceed: () => void;
  onSelectCustomer: () => void;
}

/** Right-hand order panel: line items, totals, Hold Cart / Proceed. */
export function CartPanel({ onProceed, onSelectCustomer }: Props) {
  const { settings } = useApp();
  const cart = useCart();
  const t = cart.totals(settings.taxRateBps);
  const [discountOpen, setDiscountOpen] = useState(false);
  const [editingLine, setEditingLine] = useState<CartLine | null>(null);

  const holdCart = () => {
    if (cart.lines.length === 0) return;
    ordersRepo.saveOrder(cart.buildOrder(settings.taxRateBps));
    syncEngine.refreshCounts();
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
            {cart.table
              ? `Table ${cart.table.name}${cart.guests ? ` · ${cart.guests} guests` : ''}`
              : cart.orderType === 'dine_in'
                ? 'Dine in'
                : cart.orderType === 'pickup'
                  ? 'Pickup'
                  : 'Delivery'}
          </Text>
        </View>
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
              key={line.product.id}
              onPress={() => setEditingLine(line)}
              style={styles.line}
            >
              <View style={styles.lineInner}>
              <View style={styles.lineInfo}>
                <Text variant="bodyMedium" numberOfLines={1} style={styles.lineName}>
                  {line.product.name}
                </Text>
                <Text variant="labelSmall" style={styles.lineUnit}>
                  {formatMoney(line.product.price)} each
                  {line.notes ? ` · ${line.notes}` : ''}
                </Text>
              </View>
              <View style={styles.stepper}>
                <IconButton
                  icon="minus"
                  size={14}
                  style={styles.stepBtn}
                  onPress={() =>
                    cart.setQuantity(line.product.id, line.quantity - 1)
                  }
                />
                <Text style={styles.qty}>{line.quantity}</Text>
                <IconButton
                  icon="plus"
                  size={14}
                  style={styles.stepBtn}
                  onPress={() =>
                    cart.setQuantity(line.product.id, line.quantity + 1)
                  }
                />
              </View>
              <Text variant="bodyMedium" style={styles.lineTotal}>
                {formatMoney(line.product.price * line.quantity)}
              </Text>
              </View>
            </TouchableRipple>
          ))
        )}
      </ScrollView>

      <View style={styles.footer}>
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
        <View style={styles.actions}>
          <Button
            mode="outlined"
            icon="pause"
            onPress={holdCart}
            disabled={cart.lines.length === 0}
            style={styles.holdBtn}
            textColor={antd.warning}
          >
            Hold Cart
          </Button>
          <Button
            mode="contained"
            icon="arrow-right"
            onPress={onProceed}
            disabled={cart.lines.length === 0}
            style={styles.proceedBtn}
            buttonColor={antd.success}
          >
            Proceed
          </Button>
        </View>
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
        mode="edit"
        onDismiss={() => setEditingLine(null)}
        onConfirm={(product, quantity, notes) => {
          cart.updateLine(product.id, quantity, notes || undefined);
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
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    gap: 8,
  },
  lineInfo: { flex: 1 },
  lineName: { color: antd.text },
  lineUnit: { color: antd.textTertiary },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: antd.border,
    borderRadius: RADIUS,
  },
  stepBtn: { margin: 0, width: 26, height: 26 },
  qty: {
    minWidth: 22,
    textAlign: 'center',
    color: antd.text,
    fontWeight: '600',
    fontSize: 13,
  },
  lineTotal: { minWidth: 64, textAlign: 'right', color: antd.text, fontWeight: '600' },
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
  proceedBtn: { flex: 1, borderRadius: RADIUS },
});
