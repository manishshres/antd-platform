import React from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { Text, TouchableRipple } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { antd, RADIUS } from '../theme';
import { formatMoney } from '../utils/money';
import type { Product } from '../types';

interface Props {
  product: Product;
  quantityInCart: number;
  /** Tap: add one, no modifiers/notes. Fires immediately. */
  onQuickAdd: () => void;
  /** Long-press — or any tap, for items with a required modifier group we
   *  can't skip past: opens the full customize dialog. */
  onCustomize: () => void;
}

export function ProductCard({ product, quantityInCart, onQuickAdd, onCustomize }: Props) {
  const outOfStock =
    product.stockQuantity !== null && product.stockQuantity <= 0;
  const lowStock =
    !outOfStock &&
    product.stockQuantity !== null &&
    product.lowStockThreshold !== null &&
    product.stockQuantity <= product.lowStockThreshold;
  const requiresCustomization = product.modifiers.some((g) => g.isRequired);
  const hasOptions = product.modifiers.length > 0;

  // Tap adds immediately. An earlier build deferred the add to watch for a
  // double-tap-to-customize, which cost every add ~260ms and — worse — made
  // rapid repeat-tapping ("three Cokes") open the dialog and add nothing.
  // Repeat-tap is the most common gesture on a register, so it wins the tap;
  // customize moves to long-press, which nothing else competes for.
  const handlePress = () => {
    if (requiresCustomization) {
      onCustomize();
      return;
    }
    onQuickAdd();
  };

  return (
    <TouchableRipple
      onPress={outOfStock ? undefined : handlePress}
      onLongPress={outOfStock || !hasOptions ? undefined : onCustomize}
      delayLongPress={300}
      style={[styles.card, outOfStock && styles.cardDisabled]}
      borderless
    >
      <View>
        <View style={styles.imageWrap}>
          {product.imageUrl ? (
            <Image source={{ uri: product.imageUrl }} style={styles.image} />
          ) : (
            <View style={styles.placeholder}>
              <MaterialCommunityIcons
                name={product.isCombo ? 'silverware-fork-knife' : 'food'}
                size={36}
                color={antd.textQuaternary}
              />
            </View>
          )}
          {product.isCombo && (
            <View style={styles.comboBadge}>
              <Text style={styles.comboBadgeText}>COMBO</Text>
            </View>
          )}
          {quantityInCart > 0 && (
            <View style={styles.qtyBadge}>
              <Text style={styles.qtyBadgeText}>{quantityInCart}</Text>
            </View>
          )}
          {(outOfStock || lowStock) && (
            <View
              style={[
                styles.stockBadge,
                outOfStock ? styles.stockBadgeOut : styles.stockBadgeLow,
              ]}
            >
              <Text style={styles.stockBadgeText}>
                {outOfStock ? 'Out of stock' : 'Low stock'}
              </Text>
            </View>
          )}
        </View>
        <View style={styles.body}>
          <Text variant="bodyMedium" numberOfLines={2} style={styles.name}>
            {product.name}
          </Text>
          <View style={styles.priceRow}>
            <Text variant="titleSmall" style={styles.price}>
              {formatMoney(product.price)}
            </Text>
            {/* The only cue that long-press opens options — without it the
                gesture is undiscoverable. Required-modifier items open on tap,
                so they don't get one. */}
            {hasOptions && !requiresCustomization && (
              <MaterialCommunityIcons
                name="tune-variant"
                size={14}
                color={antd.textQuaternary}
              />
            )}
          </View>
        </View>
      </View>
    </TouchableRipple>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: antd.bgContainer,
    borderRadius: RADIUS,
    borderWidth: 1,
    borderColor: antd.split,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  imageWrap: { position: 'relative' },
  image: {
    width: '100%',
    aspectRatio: 1.4,
    backgroundColor: antd.bgLayout,
  },
  placeholder: {
    width: '100%',
    aspectRatio: 1.4,
    backgroundColor: antd.bgLayout,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qtyBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    minWidth: 24,
    height: 24,
    borderRadius: RADIUS,
    backgroundColor: antd.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  qtyBadgeText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  body: { padding: 10, gap: 4 },
  name: { color: antd.text, minHeight: 38 },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  price: { color: antd.primary, fontWeight: '700' },
  cardDisabled: { opacity: 0.5 },
  comboBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    borderRadius: RADIUS,
    backgroundColor: antd.primary,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  comboBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  stockBadge: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    right: 8,
    borderRadius: RADIUS,
    paddingVertical: 3,
    alignItems: 'center',
  },
  stockBadgeOut: { backgroundColor: antd.error },
  stockBadgeLow: { backgroundColor: antd.warning },
  stockBadgeText: { color: '#fff', fontSize: 11, fontWeight: '600' },
});
