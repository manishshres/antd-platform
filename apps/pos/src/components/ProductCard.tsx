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
  onAdd: () => void;
}

export function ProductCard({ product, quantityInCart, onAdd }: Props) {
  return (
    <TouchableRipple onPress={onAdd} style={styles.card} borderless>
      <View>
        <View style={styles.imageWrap}>
          {product.imageUrl ? (
            <Image source={{ uri: product.imageUrl }} style={styles.image} />
          ) : (
            <View style={styles.placeholder}>
              <MaterialCommunityIcons
                name="food"
                size={36}
                color={antd.textQuaternary}
              />
            </View>
          )}
          {quantityInCart > 0 && (
            <View style={styles.qtyBadge}>
              <Text style={styles.qtyBadgeText}>{quantityInCart}</Text>
            </View>
          )}
        </View>
        <View style={styles.body}>
          <Text variant="bodyMedium" numberOfLines={2} style={styles.name}>
            {product.name}
          </Text>
          <Text variant="titleSmall" style={styles.price}>
            {formatMoney(product.price)}
          </Text>
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
  price: { color: antd.primary, fontWeight: '700' },
});
