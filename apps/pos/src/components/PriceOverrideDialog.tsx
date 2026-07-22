import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Dialog, Portal, Text, TextInput } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { antd, RADIUS } from '../theme';
import { formatMoney, parseMoney } from '../utils/money';
import { useEmployee } from '../state/EmployeeContext';
import { ManagerPinPrompt } from './ManagerPinPrompt';

interface Props {
  visible: boolean;
  onDismiss: () => void;
  lineName: string;
  /** Current effective unit price (cents), shown as a reference. */
  currentPrice: number;
  /** Existing override, if this line already has one — lets the dialog offer "Remove Override". */
  currentOverride?: number;
  currentReason?: string;
  /** newPrice is cents; null clears an existing override back to the normal menu price. */
  onApply: (newPrice: number | null, reason?: string) => void;
}

/**
 * Manager-authorized per-line price override — for comps ("$0, on the house")
 * or ad-hoc discounts when an issue needs resolving at the table. Changes
 * only this line, this transaction; the menu item itself is untouched.
 */
export function PriceOverrideDialog({
  visible,
  onDismiss,
  lineName,
  currentPrice,
  currentOverride,
  currentReason,
  onApply,
}: Props) {
  const { isManager, verifyManagerPin } = useEmployee();
  const [priceText, setPriceText] = useState('');
  const [reasonText, setReasonText] = useState('');
  const [error, setError] = useState('');
  const [pendingValue, setPendingValue] = useState<{ price: number | null; reason?: string } | null>(null);
  const [pinPending, setPinPending] = useState(false);
  const [pinBusy, setPinBusy] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setPriceText(
        currentOverride !== undefined ? (currentOverride / 100).toFixed(2) : '',
      );
      setReasonText(currentReason ?? '');
      setError('');
      setPinPending(false);
      setPinError(null);
    }
  }, [visible, currentOverride, currentReason]);

  const requestApply = (newPrice: number | null, reason?: string) => {
    if (isManager) {
      onApply(newPrice, reason);
      onDismiss();
      return;
    }
    setPinError(null);
    setPendingValue({ price: newPrice, reason });
    setPinPending(true);
  };

  const submitManagerPin = async (pin: string) => {
    if (!pendingValue) return;
    setPinBusy(true);
    setPinError(null);
    try {
      await verifyManagerPin(pin);
      onApply(pendingValue.price, pendingValue.reason);
      setPinPending(false);
      onDismiss();
    } catch (err) {
      setPinError(err instanceof Error ? err.message : 'Could not verify PIN.');
    } finally {
      setPinBusy(false);
    }
  };

  const confirmPrice = () => {
    const cents = parseMoney(priceText);
    if (!priceText.trim() || Number.isNaN(cents) || cents < 0) {
      setError('Enter a valid price (0 or more).');
      return;
    }
    requestApply(cents, reasonText.trim() || undefined);
  };

  const removeOverride = () => requestApply(null);

  return (
    <Portal>
      <Dialog visible={visible} onDismiss={onDismiss} style={styles.dialog}>
        <Dialog.Title>Override Price</Dialog.Title>
        <Dialog.Content style={{ gap: 12 }}>
          <View style={styles.header}>
            <MaterialCommunityIcons
              name="pencil-lock-outline"
              size={20}
              color={antd.primary}
            />
            <Text variant="bodyMedium" style={styles.lineName} numberOfLines={1}>
              {lineName}
            </Text>
          </View>
          <Text variant="labelSmall" style={{ color: antd.textTertiary }}>
            Current price: {formatMoney(currentPrice)}
            {currentOverride !== undefined ? ' (overridden)' : ''}
          </Text>
          <TextInput
            mode="outlined"
            keyboardType="decimal-pad"
            label="New unit price"
            placeholder="0.00"
            value={priceText}
            onChangeText={(v) => {
              setPriceText(v);
              setError('');
            }}
            left={<TextInput.Icon icon="currency-usd" />}
            outlineStyle={{ borderRadius: RADIUS }}
            error={Boolean(error)}
          />
          {error ? (
            <Text variant="labelSmall" style={{ color: antd.error }}>
              {error}
            </Text>
          ) : (
            <Text variant="labelSmall" style={{ color: antd.textTertiary }}>
              Use 0.00 to comp the item. Requires manager approval.
            </Text>
          )}
          <TextInput
            mode="outlined"
            label="Reason (optional)"
            placeholder="e.g. customer complaint, comped dessert"
            value={reasonText}
            onChangeText={setReasonText}
            outlineStyle={{ borderRadius: RADIUS }}
          />
        </Dialog.Content>
        <Dialog.Actions>
          {currentOverride !== undefined && (
            <Button textColor={antd.error} onPress={removeOverride}>
              Remove Override
            </Button>
          )}
          <Button onPress={onDismiss}>Cancel</Button>
          <Button mode="contained" onPress={confirmPrice}>
            Apply
          </Button>
        </Dialog.Actions>
      </Dialog>

      <ManagerPinPrompt
        visible={pinPending}
        reason={`Approve price override for "${lineName}"`}
        busy={pinBusy}
        errorMessage={pinError}
        onSubmit={submitManagerPin}
        onCancel={() => setPinPending(false)}
      />
    </Portal>
  );
}

const styles = StyleSheet.create({
  dialog: {
    borderRadius: RADIUS,
    backgroundColor: antd.bgContainer,
    maxWidth: 420,
    alignSelf: 'center',
    width: '100%',
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  lineName: { color: antd.text, fontWeight: '600', flex: 1 },
});
