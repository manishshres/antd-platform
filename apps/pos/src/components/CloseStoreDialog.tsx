import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Dialog, Portal, Text, TextInput } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { antd, RADIUS } from '../theme';
import { formatMoney, parseMoney } from '../utils/money';
import { useApp } from '../state/AppContext';
import { useEmployee } from '../state/EmployeeContext';
import * as drawerRepo from '../db/drawerRepo';
import type { DrawerSession } from '../types';

interface Props {
  visible: boolean;
  onDismiss: () => void;
}

export function CloseStoreDialog({ visible, onDismiss }: Props) {
  const { endDay } = useApp();
  const { employee } = useEmployee();
  
  const [counted, setCounted] = useState('');
  const [remarks, setRemarks] = useState('');
  
  // We compute the current open drawer on mount (or when visibility changes)
  const [session, setSession] = useState<DrawerSession | null>(null);
  const [expected, setExpected] = useState<number | null>(null);

  useEffect(() => {
    if (visible) {
      setCounted('');
      setRemarks('');
      const openSession = drawerRepo.getOpenSession();
      setSession(openSession);
      if (openSession) {
        const sales = drawerRepo.salesSince(openSession.openedAt);
        setExpected(openSession.openingAmount + sales.cashSales);
      } else {
        setExpected(null);
      }
    }
  }, [visible]);

  const handleClose = () => {
    const employeeName = employee?.displayName ?? 'Manager';
    
    // If a drawer is open, close it first
    if (session) {
      const countedCents = counted.trim() ? parseMoney(counted) : null;
      if (countedCents === null) {
        return; // require a valid amount
      }
      drawerRepo.closeSession(session.id, countedCents, remarks.trim() || null);
    }
    
    // End the business day
    endDay(employeeName);
    onDismiss();
  };

  const countedCents = counted.trim() ? parseMoney(counted) : null;
  const difference = (countedCents !== null && expected !== null) ? countedCents - expected : null;

  return (
    <Portal>
      <Dialog visible={visible} onDismiss={onDismiss} style={styles.dialog}>
        <View style={styles.header}>
          <MaterialCommunityIcons name="store-remove-outline" size={24} color={antd.error} />
          <Text variant="titleMedium" style={styles.title}>
            End Business Day
          </Text>
        </View>

        <Dialog.Content>
          <Text variant="bodyMedium" style={{ marginBottom: 16 }}>
            Are you sure you want to end the business day? You will not be able to take new orders until a new day is started.
          </Text>

          {session && expected !== null ? (
            <View style={styles.drawerSection}>
              <Text variant="titleSmall" style={{ marginBottom: 8, color: antd.text }}>
                Cash Drawer Summary
              </Text>
              
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Expected Amount</Text>
                <Text style={[styles.summaryValue, { fontWeight: 'bold' }]}>{formatMoney(expected)}</Text>
              </View>

              <Text style={[styles.summaryLabel, { marginTop: 12, marginBottom: 4 }]}>Counted Amount</Text>
              <TextInput
                mode="outlined"
                placeholder="$0.00"
                value={counted}
                onChangeText={setCounted}
                keyboardType="decimal-pad"
                style={{ backgroundColor: antd.bgContainer }}
              />

              <View style={[styles.summaryRow, { marginTop: 12 }]}>
                <Text style={styles.summaryLabel}>Difference</Text>
                <Text
                  style={[
                    styles.summaryValue,
                    { fontWeight: 'bold' },
                    difference !== null && difference > 0 ? { color: antd.success } : {},
                    difference !== null && difference < 0 ? { color: antd.error } : {},
                  ]}
                >
                  {difference === null ? '—' : formatMoney(difference)}
                </Text>
              </View>

              <Text style={[styles.summaryLabel, { marginTop: 12, marginBottom: 4 }]}>Remarks (Optional)</Text>
              <TextInput
                mode="outlined"
                placeholder="Notes about the drawer"
                value={remarks}
                onChangeText={setRemarks}
                multiline
                style={{ backgroundColor: antd.bgContainer }}
              />
            </View>
          ) : (
            <Text variant="bodySmall" style={{ color: antd.textTertiary, fontStyle: 'italic' }}>
              No cash drawer is currently open.
            </Text>
          )}
        </Dialog.Content>

        <Dialog.Actions>
          <Button onPress={onDismiss} textColor={antd.textSecondary}>
            Cancel
          </Button>
          <Button
            mode="contained"
            onPress={handleClose}
            buttonColor={antd.error}
            disabled={session !== null && countedCents === null}
            style={{ borderRadius: RADIUS, marginLeft: 8 }}
          >
            End Day
          </Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
}

const styles = StyleSheet.create({
  dialog: {
    backgroundColor: antd.bgContainer,
    borderRadius: RADIUS * 2,
    maxWidth: 400,
    alignSelf: 'center',
    width: '100%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 24,
    paddingBottom: 16,
    gap: 12,
  },
  title: {
    fontWeight: '600',
    color: antd.text,
  },
  drawerSection: {
    backgroundColor: antd.bgLayout,
    padding: 16,
    borderRadius: RADIUS,
    marginTop: 8,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  summaryLabel: {
    fontSize: 14,
    color: antd.textSecondary,
  },
  summaryValue: {
    fontSize: 14,
    color: antd.text,
  },
});
