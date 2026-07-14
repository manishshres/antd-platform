import React, { useEffect, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import {
  Button,
  Dialog,
  Divider,
  IconButton,
  Portal,
  Text,
  TextInput,
} from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { antd, RADIUS } from '../theme';
import { formatMoney } from '../utils/money';
import type { Product } from '../types';

interface Props {
  visible: boolean;
  product: Product | null;
  onDismiss: () => void;
  onConfirm: (product: Product, quantity: number, notes: string) => void;
  /** When editing an existing cart line: pre-fill these values. */
  initialQuantity?: number;
  initialNotes?: string;
  mode?: 'add' | 'edit';
}

export function ItemCustomizeDialog({
  visible,
  product,
  onDismiss,
  onConfirm,
  initialQuantity,
  initialNotes,
  mode = 'add',
}: Props) {
  const [quantity, setQuantity] = useState(initialQuantity ?? 1);
  const [notes, setNotes] = useState(initialNotes ?? '');

  useEffect(() => {
    if (visible) {
      setQuantity(initialQuantity ?? 1);
      setNotes(initialNotes ?? '');
    }
  }, [visible, product?.id, initialQuantity, initialNotes]);

  if (!product) return null;

  const lineTotal = product.price * quantity;

  return (
    <Portal>
      <Dialog visible={visible} onDismiss={onDismiss} style={styles.dialog}>
        <Dialog.Title style={styles.title}>{product.name}</Dialog.Title>
        <Dialog.Content style={styles.content}>
          {product.imageUrl ? (
            <Image source={{ uri: product.imageUrl }} style={styles.image} />
          ) : (
            <View style={styles.imagePlaceholder}>
              <MaterialCommunityIcons name="food" size={40} color={antd.textQuaternary} />
            </View>
          )}

          {product.description ? (
            <Text variant="bodySmall" style={styles.description}>
              {product.description}
            </Text>
          ) : null}

          <Text variant="titleMedium" style={styles.price}>
            {formatMoney(product.price)}
          </Text>

          <Divider style={{ marginVertical: 12 }} />

          <View style={styles.qtyRow}>
            <Text variant="labelMedium" style={styles.qtyLabel}>
              Quantity
            </Text>
            <View style={styles.stepper}>
              <IconButton
                icon="minus"
                size={18}
                style={styles.stepBtn}
                disabled={quantity <= 1}
                onPress={() => setQuantity((q) => Math.max(1, q - 1))}
              />
              <Text variant="titleMedium" style={styles.qty}>
                {quantity}
              </Text>
              <IconButton
                icon="plus"
                size={18}
                style={styles.stepBtn}
                disabled={quantity >= 20}
                onPress={() => setQuantity((q) => Math.min(20, q + 1))}
              />
            </View>
          </View>

          <TextInput
            label="Special instructions / notes"
            mode="outlined"
            multiline
            numberOfLines={3}
            value={notes}
            onChangeText={setNotes}
            placeholder="e.g. no onions, extra sauce, allergy info…"
            style={styles.notes}
            outlineStyle={{ borderRadius: RADIUS }}
          />
        </Dialog.Content>

        <Dialog.Actions style={styles.actions}>
          <Button onPress={onDismiss} textColor={antd.textSecondary}>
            Cancel
          </Button>
          <Button
            mode="contained"
            onPress={() => {
              onConfirm(product, quantity, notes.trim());
              onDismiss();
            }}
            style={{ borderRadius: RADIUS }}
          >
            {mode === 'edit' ? `Update Item · ${formatMoney(lineTotal)}` : `Add to Cart · ${formatMoney(lineTotal)}`}
          </Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
}

const styles = StyleSheet.create({
  dialog: {
    borderRadius: RADIUS,
    backgroundColor: antd.bgContainer,
    maxWidth: 440,
    alignSelf: 'center',
    width: '100%',
  },
  title: { color: antd.text, fontWeight: '700' },
  content: { gap: 8 },
  image: { width: '100%', height: 160, borderRadius: RADIUS, backgroundColor: antd.bgLayout },
  imagePlaceholder: {
    width: '100%',
    height: 100,
    borderRadius: RADIUS,
    backgroundColor: antd.bgLayout,
    alignItems: 'center',
    justifyContent: 'center',
  },
  description: { color: antd.textSecondary },
  price: { color: antd.primary, fontWeight: '700' },
  qtyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  qtyLabel: { color: antd.textSecondary },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: antd.border,
    borderRadius: RADIUS,
  },
  stepBtn: { margin: 0, width: 36, height: 36 },
  qty: {
    minWidth: 36,
    textAlign: 'center',
    color: antd.text,
    fontWeight: '700',
  },
  notes: { backgroundColor: antd.bgContainer },
  actions: { gap: 8, paddingHorizontal: 16, paddingBottom: 8 },
});
