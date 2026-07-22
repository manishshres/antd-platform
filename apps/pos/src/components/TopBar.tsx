import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, SegmentedButtons, Searchbar, Text, TouchableRipple } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { antd, RADIUS } from '../theme';
import { useApp } from '../state/AppContext';
import { useCart } from '../state/CartContext';
import { printQueue } from '../printing/printQueueService';
import type { OrderType } from '../types';

interface Props {
  search?: string;
  onSearch?: (value: string) => void;
  onSelectTable: () => void;
}

const QUICK_SERVICE_TYPES: { value: OrderType; label: string; icon: string }[] = [
  { value: 'pickup', label: 'Pickup', icon: 'walk' },
  { value: 'delivery', label: 'Delivery', icon: 'moped' },
];

/** Search + connectivity/sync status + table shortcut, shown on every screen. */
export function TopBar({ search, onSearch, onSelectTable }: Props) {
  const { online, sync, syncNow, settings } = useApp();
  const { table, orderType, setOrderType } = useCart();
  const [failedPrints, setFailedPrints] = useState(0);

  // A failed kitchen ticket must be loud — otherwise staff assume the food is
  // cooking when nothing printed. Tap to retry the whole failed set.
  useEffect(() => printQueue.subscribe(setFailedPrints), []);

  return (
    <View style={styles.container}>
      {onSearch ? (
        <Searchbar
          placeholder="Search products…"
          value={search ?? ''}
          onChangeText={onSearch}
          style={styles.search}
          inputStyle={styles.searchInput}
          iconColor={antd.textTertiary}
        />
      ) : (
        <View style={styles.titleWrap}>
          <Text variant="titleMedium" style={styles.title}>
            {settings.locationName || 'Coneeko POS'}
          </Text>
        </View>
      )}

      <View style={styles.right}>
        {!table && (
          <SegmentedButtons
            value={orderType === 'dine_in' ? '' : orderType}
            onValueChange={(v) => setOrderType(v as OrderType)}
            style={styles.quickService}
            buttons={QUICK_SERVICE_TYPES.map((t) => ({
              value: t.value,
              label: t.label,
              icon: t.icon,
            }))}
          />
        )}
        {failedPrints > 0 && (
          <TouchableRipple
            onPress={() => printQueue.retryAllFailed(settings)}
            style={styles.printAlert}
            borderless
          >
            <View style={styles.printAlertInner}>
              <MaterialCommunityIcons
                name="printer-alert"
                size={18}
                color={antd.error}
              />
              <Text variant="labelSmall" style={styles.printAlertText}>
                {failedPrints} print{failedPrints > 1 ? 's' : ''} failed · Retry
              </Text>
            </View>
          </TouchableRipple>
        )}
        <View style={styles.status}>
          <MaterialCommunityIcons
            name={online ? 'wifi' : 'wifi-off'}
            size={18}
            color={online ? antd.success : antd.error}
          />
          <Text variant="labelSmall" style={styles.statusText}>
            {online ? 'Online' : 'Offline'}
          </Text>
        </View>
        <Button
          mode="text"
          compact
          icon={sync.syncing ? 'sync' : 'cloud-sync-outline'}
          loading={sync.syncing}
          disabled={!online || sync.syncing}
          onPress={syncNow}
          textColor={antd.textSecondary}
        >
          Sync
        </Button>
        <Button
          mode="contained"
          icon="table-furniture"
          onPress={onSelectTable}
          style={styles.tableButton}
          contentStyle={styles.tableButtonContent}
        >
          {table ? `Table ${table.name}` : 'Select Table'}
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 12,
    backgroundColor: antd.bgContainer,
    borderBottomWidth: 1,
    borderBottomColor: antd.split,
  },
  search: {
    flex: 1,
    maxWidth: 420,
    height: 40,
    borderRadius: RADIUS,
    backgroundColor: antd.bgLayout,
    borderWidth: 1,
    borderColor: antd.border,
  },
  searchInput: {
    fontSize: 14,
    minHeight: 0,
    alignSelf: 'center',
  },
  titleWrap: { flex: 1 },
  title: { color: antd.text, fontWeight: '600' },
  right: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginLeft: 'auto',
  },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: RADIUS,
    backgroundColor: antd.bgLayout,
    borderWidth: 1,
    borderColor: antd.split,
  },
  statusText: { color: antd.textSecondary },
  printAlert: {
    borderRadius: RADIUS,
    borderWidth: 1,
    borderColor: antd.error,
    backgroundColor: antd.errorBg,
  },
  printAlertInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  printAlertText: { color: antd.error, fontWeight: '600' },
  quickService: { maxWidth: 220 },
  tableButton: { borderRadius: RADIUS },
  tableButtonContent: { height: 40 },
});
