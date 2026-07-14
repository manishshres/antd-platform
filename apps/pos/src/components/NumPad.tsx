import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text, TouchableRipple } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { antd, RADIUS } from '../theme';

interface Props {
  onDigit: (digit: string) => void;
  onBackspace: () => void;
  onClear: () => void;
}

const KEYS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['00', '0', 'back'],
];

/** Chunky cash-tender keypad, sized for fingers on a tablet. */
export function NumPad({ onDigit, onBackspace, onClear }: Props) {
  return (
    <View style={styles.container}>
      {KEYS.map((row, i) => (
        <View key={i} style={styles.row}>
          {row.map((key) => (
            <TouchableRipple
              key={key}
              style={styles.key}
              onPress={() =>
                key === 'back' ? onBackspace() : onDigit(key)
              }
              onLongPress={key === 'back' ? onClear : undefined}
              borderless
            >
              {key === 'back' ? (
                <MaterialCommunityIcons
                  name="backspace-outline"
                  size={24}
                  color={antd.textSecondary}
                />
              ) : (
                <Text style={styles.keyText}>{key}</Text>
              )}
            </TouchableRipple>
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 8 },
  row: { flexDirection: 'row', gap: 8 },
  key: {
    flex: 1,
    height: 56,
    borderRadius: RADIUS,
    borderWidth: 1,
    borderColor: antd.border,
    backgroundColor: antd.bgContainer,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  keyText: { fontSize: 20, fontWeight: '600', color: antd.text },
});
