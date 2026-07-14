import React, { useEffect, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { Banner, Button, Text } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { antd, RADIUS } from '../theme';
import { useApp } from '../state/AppContext';
import * as ordersRepo from '../db/ordersRepo';
import { syncEngine } from '../sync/syncEngine';
import { formatMoney } from '../utils/money';
import { OrderStatusChip } from '../components/OrderStatusChip';
import type { LocalOrder } from '../types';

/** Orders taken while disconnected, waiting to be pushed to the server. */
export function OfflineOrdersScreen() {
  const { online, sync, syncNow, dataVersion } = useApp();
  const [orders, setOrders] = useState<LocalOrder[]>([]);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    setOrders(ordersRepo.listOrders(['pending_sync', 'failed']));
  }, [dataVersion, refresh, sync.pendingOrders, sync.failedOrders]);

  const retry = (order: LocalOrder) => {
    ordersRepo.requeue(order.id);
    syncEngine.refreshCounts();
    setRefresh((n) => n + 1);
    if (online) syncNow();
  };

  return (
    <View style={styles.container}>
      <Banner
        visible={!online}
        icon="cloud-off-outline"
        style={styles.banner}
      >
        Visibility of system status: this register is offline. Orders below are
        stored safely on the device and will sync automatically once the
        connection is restored.
      </Banner>

      <View style={styles.toolbar}>
        <View>
          <Text variant="titleMedium" style={styles.title}>
            Offline Orders
          </Text>
          <Text variant="bodySmall" style={styles.subtitle}>
            {sync.pendingOrders} pending · {sync.failedOrders} failed
            {sync.lastSyncAt
              ? ` · last sync ${new Date(sync.lastSyncAt).toLocaleTimeString()}`
              : ''}
          </Text>
        </View>
        <Button
          mode="contained"
          icon="cloud-sync-outline"
          loading={sync.syncing}
          disabled={!online || sync.syncing}
          onPress={syncNow}
          style={{ borderRadius: RADIUS }}
        >
          Sync Now
        </Button>
      </View>

      {sync.lastError && (
        <Text variant="bodySmall" style={styles.error}>
          Last sync error: {sync.lastError}
        </Text>
      )}

      <FlatList
        data={orders}
        keyExtractor={(o) => o.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.empty}>
            <MaterialCommunityIcons
              name="cloud-check-outline"
              size={44}
              color={antd.success}
            />
            <Text variant="bodyMedium" style={styles.emptyText}>
              All orders are synced
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <View
            style={[styles.card, item.status === 'failed' && styles.cardFailed]}
          >
            <View style={styles.cardRow}>
              <View style={{ flex: 1 }}>
                <Text variant="titleSmall" style={styles.cardTitle}>
                  {item.customerName}
                  {item.tableName ? `  ·  Table ${item.tableName}` : ''}
                </Text>
                <Text variant="labelSmall" style={styles.cardSub}>
                  {new Date(item.createdAt).toLocaleString()} ·{' '}
                  {item.items.reduce((n, i) => n + i.quantity, 0)} items ·{' '}
                  {item.paymentMethod
                    ? item.paymentMethod === 'cash'
                      ? 'Paid cash'
                      : 'Paid card'
                    : 'Unpaid'}
                </Text>
                {item.errorMessage && (
                  <Text variant="labelSmall" style={styles.cardError}>
                    {item.errorMessage}
                  </Text>
                )}
              </View>
              <View style={styles.cardRight}>
                <OrderStatusChip status={item.status} />
                <Text variant="titleSmall" style={styles.total}>
                  {formatMoney(item.totalAmount)}
                </Text>
              </View>
            </View>
            {item.status === 'failed' && (
              <View style={styles.cardActions}>
                <Button
                  mode="outlined"
                  icon="refresh"
                  onPress={() => retry(item)}
                  style={{ borderRadius: RADIUS }}
                >
                  Retry Sync
                </Button>
              </View>
            )}
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: antd.bgLayout, padding: 16 },
  banner: {
    marginBottom: 12,
    borderRadius: RADIUS,
    backgroundColor: antd.warningBg,
    borderWidth: 1,
    borderColor: antd.warningBorder,
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  title: { color: antd.text, fontWeight: '700' },
  subtitle: { color: antd.textTertiary },
  error: { color: antd.error, marginBottom: 8 },
  list: { gap: 10, paddingBottom: 16 },
  card: {
    backgroundColor: antd.bgContainer,
    borderRadius: RADIUS,
    borderWidth: 1,
    borderColor: antd.split,
    padding: 14,
    gap: 10,
  },
  cardFailed: { borderColor: antd.errorBorder, backgroundColor: antd.errorBg },
  cardRow: { flexDirection: 'row', gap: 10 },
  cardTitle: { color: antd.text, fontWeight: '600' },
  cardSub: { color: antd.textTertiary },
  cardError: { color: antd.error, marginTop: 4 },
  cardRight: { alignItems: 'flex-end', gap: 6 },
  total: { color: antd.text, fontWeight: '700' },
  cardActions: { flexDirection: 'row', justifyContent: 'flex-end' },
  empty: { alignItems: 'center', paddingTop: 60, gap: 10 },
  emptyText: { color: antd.textTertiary },
});
