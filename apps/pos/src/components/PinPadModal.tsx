import React, { useEffect, useState } from 'react';
import { Modal, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Text } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { antd, RADIUS } from '../theme';
import { NumPad } from './NumPad';

interface Props {
  visible: boolean;
  title?: string;
  subtitle?: string;
  pinLength?: number;
  busy?: boolean;
  errorMessage?: string | null;
  onSubmit: (pin: string) => void;
  onCancel?: () => void;
}

export function PinPadModal({
  visible,
  title = 'Enter PIN',
  subtitle,
  pinLength = 6,
  busy = false,
  errorMessage = null,
  onSubmit,
  onCancel,
}: Props) {
  const [pin, setPin] = useState('');

  useEffect(() => {
    if (!visible) setPin('');
  }, [visible]);

  useEffect(() => {
    if (visible && pin.length === pinLength) {
      const value = pin;
      setPin('');
      onSubmit(value);
    }
  }, [visible, pin, pinLength, onSubmit]);

  const onDigit = (digit: string) => {
    setPin((prev) => (prev.length >= pinLength ? prev : prev + digit));
  };
  const onBackspace = () => setPin((prev) => prev.slice(0, -1));
  const onClear = () => setPin('');

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={() => {
        if (!busy && onCancel) onCancel();
      }}
    >
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text variant="titleMedium" style={styles.title}>
            {title}
         </Text>
          {subtitle ? (
            <Text variant="bodySmall" style={styles.subtitle}>
              {subtitle}
           </Text>
          ) : null}

          <View style={styles.dots}>
            {Array.from({ length: pinLength }).map((_, i) => (
              <View
                key={i}
                style={[
                  styles.dot,
                  i < pin.length && styles.dotFilled,
                  errorMessage && styles.dotError,
                ]}
              />
            ))}
         </View>

          {errorMessage ? (
            <View style={styles.errorRow}>
              <MaterialCommunityIcons
                name="alert-circle-outline"
                size={16}
                color={antd.error}
              />
              <Text variant="labelMedium" style={{ color: antd.error }}>
                {errorMessage}
             </Text>
           </View>
          ) : null}

          <View style={styles.numpadWrap}>
            <NumPad onDigit={onDigit} onBackspace={onBackspace} onClear={onClear} />
         </View>

          {busy ? (
            <View style={styles.busy}>
              <ActivityIndicator />
           </View>
          ) : onCancel ? (
            <Button mode="text" onPress={onCancel} textColor={antd.textSecondary}>
              Cancel
           </Button>
          ) : null}
       </View>
     </View>
   </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  sheet: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: antd.bgContainer,
    borderRadius: RADIUS * 2,
    padding: 24,
    alignItems: 'center',
    gap: 12,
  },
  title: { color: antd.text, fontWeight: '700' },
  subtitle: { color: antd.textSecondary, textAlign: 'center' },
  dots: {
    flexDirection: 'row',
    gap: 14,
    marginVertical: 12,
  },
  dot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: antd.split,
    backgroundColor: 'transparent',
  },
  dotFilled: {
    backgroundColor: antd.primary,
    borderColor: antd.primary,
  },
  dotError: {
    borderColor: antd.error,
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  numpadWrap: {
    width: '100%',
    maxWidth: 320,
  },
  busy: {
    paddingVertical: 8,
  },
});
