import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import {
  Button,
  Dialog,
  Portal,
  Text,
  TextInput,
  TouchableRipple,
} from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { antd, RADIUS } from '../theme';
import { formatMoney } from '../utils/money';
import * as catalogRepo from '../db/catalogRepo';
import type { Discount } from '../types';

interface Props {
  visible: boolean;
  onDismiss: () => void;
  selectedId: string | null;
  onApply: (discount: Discount | null) => void;
}

function describe(d: Discount): string {
  return d.type === 'percent' ? `${d.value}% off` : `${formatMoney(d.value)} off`;
}

/**
 * Apply an org discount or promo code. Works entirely from the offline cache,
 * so the totals a cashier quotes are exactly what the server prices on sync.
 */
export function DiscountDialog({ visible, onDismiss, selectedId, onApply }: Props) {
  const [discounts, setDiscounts] = useState<Discount[]>([]);
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState('');

  useEffect(() => {
    if (visible) {
      setDiscounts(catalogRepo.getDiscounts());
      setCode('');
      setCodeError('');
    }
  }, [visible]);

  const applyCode = () => {
    const found = catalogRepo.findDiscountByCode(code);
    if (!found) {
      setCodeError(`Code "${code.trim().toUpperCase()}" not found`);
      return;
    }
    onApply(found);
    onDismiss();
  };

  return (
    <Portal>
      <Dialog visible={visible} onDismiss={onDismiss} style={styles.dialog}>
        <Dialog.Title>Discount / Coupon</Dialog.Title>
        <Dialog.Content style={{ gap: 12 }}>
          <View style={styles.codeRow}>
            <TextInput
              label="Coupon code"
              mode="outlined"
              autoCapitalize="characters"
              autoCorrect={false}
              value={code}
              onChangeText={(v) => {
                setCode(v);
                setCodeError('');
              }}
              style={{ flex: 1 }}
              outlineStyle={{ borderRadius: RADIUS }}
              error={Boolean(codeError)}
            />
            <Button
              mode="contained"
              onPress={applyCode}
              disabled={!code.trim()}
              style={{ borderRadius: RADIUS, alignSelf: 'center' }}
            >
              Apply
            </Button>
          </View>
          {codeError ? (
            <Text variant="labelSmall" style={{ color: antd.error }}>
              {codeError}
            </Text>
          ) : null}

          <Text variant="labelMedium" style={{ color: antd.textSecondary }}>
            Available discounts
          </Text>
          <ScrollView style={styles.list}>
            {discounts.length === 0 ? (
              <Text variant="bodySmall" style={{ color: antd.textTertiary }}>
                No discounts cached yet — sync while online to load them.
              </Text>
            ) : (
              discounts.map((d) => {
                const selected = selectedId === d.id;
                return (
                  <TouchableRipple
                    key={d.id}
                    onPress={() => {
                      onApply(selected ? null : d);
                      onDismiss();
                    }}
                    style={[styles.item, selected && styles.itemSelected]}
                    borderless
                  >
                    <View style={styles.itemInner}>
                      <MaterialCommunityIcons
                        name="tag-outline"
                        size={18}
                        color={selected ? antd.primary : antd.textTertiary}
                      />
                      <View style={{ flex: 1 }}>
                        <Text variant="bodyMedium" style={{ color: antd.text }}>
                          {d.name}
                        </Text>
                        <Text variant="labelSmall" style={{ color: antd.textTertiary }}>
                          {describe(d)}
                          {d.code ? `  ·  code ${d.code}` : ''}
                          {d.requiresManager ? '  ·  manager' : ''}
                        </Text>
                      </View>
                      {selected && (
                        <MaterialCommunityIcons
                          name="check-circle"
                          size={20}
                          color={antd.primary}
                        />
                      )}
                    </View>
                  </TouchableRipple>
                );
              })
            )}
          </ScrollView>
        </Dialog.Content>
        <Dialog.Actions>
          {selectedId && (
            <Button
              textColor={antd.error}
              onPress={() => {
                onApply(null);
                onDismiss();
              }}
            >
              Remove Discount
            </Button>
          )}
          <Button onPress={onDismiss}>Close</Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
}

const styles = StyleSheet.create({
  dialog: {
    borderRadius: RADIUS,
    backgroundColor: antd.bgContainer,
    maxWidth: 480,
    alignSelf: 'center',
    width: '100%',
  },
  codeRow: { flexDirection: 'row', gap: 10 },
  list: { maxHeight: 260 },
  item: {
    borderRadius: RADIUS,
    borderWidth: 1,
    borderColor: antd.split,
    marginBottom: 8,
  },
  itemSelected: { borderColor: antd.primary, backgroundColor: antd.primaryBg },
  itemInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 10,
  },
});
