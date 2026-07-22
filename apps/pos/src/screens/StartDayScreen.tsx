import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Text, TextInput } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { antd, RADIUS } from '../theme';
import { useApp } from '../state/AppContext';
import { useEmployee } from '../state/EmployeeContext';
import * as businessDayRepo from '../db/businessDayRepo';
import * as drawerRepo from '../db/drawerRepo';
import { parseMoney } from '../utils/money';
import { fmtDate } from '../utils/dates';

/**
 * Full-screen gate shown when no business day is open.
 * The employee must tap "Start Day" before they can access the POS.
 */
export function StartDayScreen() {
  const { startDay } = useApp();
  const { employee } = useEmployee();
  const [amount, setAmount] = useState('');

  const recentDays = businessDayRepo.listRecentDays(5);

  const handleStart = () => {
    const name = employee?.displayName ?? 'Unknown';
    startDay(name);
    drawerRepo.openSession(parseMoney(amount));
  };

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <View style={styles.iconWrap}>
          <MaterialCommunityIcons name="store-clock-outline" size={64} color={antd.primary} />
        </View>
        <Text variant="headlineSmall" style={styles.title}>
          Start Your Day
        </Text>
        <Text variant="bodyMedium" style={styles.subtitle}>
          Open the store for today before taking orders. All orders placed today
          will be grouped under this business day.
        </Text>
        <TextInput
          mode="outlined"
          label="Opening Drawer Amount"
          placeholder="$0.00"
          value={amount}
          onChangeText={setAmount}
          keyboardType="decimal-pad"
          style={{ width: '100%', marginBottom: 24, backgroundColor: antd.bgContainer }}
        />
        <Button
          mode="contained"
          icon="play-circle-outline"
          onPress={handleStart}
          style={styles.startBtn}
          contentStyle={styles.startBtnContent}
          labelStyle={styles.startBtnLabel}
        >
          Start Day
        </Button>
      </View>

      {recentDays.length > 0 && (
        <View style={styles.historyCard}>
          <Text variant="titleSmall" style={styles.historyTitle}>
            Recent Days
          </Text>
          {recentDays.map((day) => (
            <View key={day.id} style={styles.historyRow}>
              <MaterialCommunityIcons
                name={day.closedAt ? 'check-circle-outline' : 'clock-outline'}
                size={18}
                color={day.closedAt ? antd.success : antd.warning}
              />
              <Text variant="bodyMedium" style={styles.historyDate}>
                {day.date}
              </Text>
              <Text variant="bodySmall" style={styles.historyMeta}>
                {day.openedBy}
                {day.closedAt
                  ? ` · closed by ${day.closedBy ?? '—'}`
                  : ' · still open'}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: antd.bgLayout,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 24,
  },
  card: {
    backgroundColor: antd.bgContainer,
    borderRadius: RADIUS * 2,
    borderWidth: 1,
    borderColor: antd.split,
    padding: 48,
    alignItems: 'center',
    maxWidth: 480,
    width: '100%',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  iconWrap: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: antd.primaryBg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  title: {
    color: antd.text,
    fontWeight: '700',
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    color: antd.textSecondary,
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 22,
  },
  startBtn: {
    borderRadius: RADIUS,
    minWidth: 200,
  },
  startBtnContent: { height: 52 },
  startBtnLabel: { fontSize: 16, fontWeight: '600' },
  historyCard: {
    backgroundColor: antd.bgContainer,
    borderRadius: RADIUS,
    borderWidth: 1,
    borderColor: antd.split,
    padding: 20,
    maxWidth: 480,
    width: '100%',
    gap: 10,
  },
  historyTitle: {
    color: antd.text,
    fontWeight: '600',
    marginBottom: 4,
  },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  historyDate: { color: antd.text, fontWeight: '500' },
  historyMeta: { color: antd.textTertiary, flex: 1 },
});
