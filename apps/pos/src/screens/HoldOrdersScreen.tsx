import React, { useEffect, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { Button, Text } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { antd, RADIUS } from '../theme';
import { useApp } from '../state/AppContext';
import { useCart } from '../state/CartContext';
import * as ordersRepo from '../db/ordersRepo';
import { syncEngine } from '../sync/syncEngine';
import { formatMoney } from '../utils/money';
import { OrderStatusChip } from '../components/OrderStatusChip';
import type { LocalOrder } from '../types';
import type { ScreenName } from '../navigation';

interface Props {
  onNavigate: (screen: ScreenName) => void;
}

/** Orders parked on this device; resume one back into the cart or discard it. */
export function HoldOrdersScreen({ onNavigate }: Props) {
  const { dataVersion } = useApp();
  const cart = useCart();
  const [orders, setOrders] = useState<LocalOrder[]>([]);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    setOrders(ordersRepo.listOrders(['held']));
  }, [dataVersion, refresh]);

  const resume = (order: LocalOrder) => {
    cart.loadOrder(order);
    onNavigate('home');
  };

  const discard = (order: LocalOrder) => {
    ordersRepo.deleteOrder(order.id);
    syncEngine.refreshCounts();
    setRefresh((n) => n + 1);
  };

  return (
    <View style={styles.container}>
      <Text variant="titleMedium" style={styles.title}>
        Held Orders
      </Text>
      <Text variant="bodySmall" style={styles.subtitle}>
        Parked carts stay on this register until resumed — they are never sent
        to the kitchen or the server.
      </Text>

      <FlatList
        data={orders}
        keyExtractor={(o) => o.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.empty}>
            <MaterialCommunityIcons
              name="pause-circle-outline"
              size={44}
              color={antd.textQuaternary}
            />
            <Text variant="bodyMedium" style={styles.emptyText}>
              No orders on hold
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={{ flex: 1 }}>
                <Text variant="titleSmall" style={styles.cardTitle}>
                  {item.customerName}
                  {item.tableName ? `  ·  Table ${item.tableName}` : ''}
                </Text>
                <Text variant="labelSmall" style={styles.cardSub}>
                  {new Date(item.createdAt).toLocaleString()} ·{' '}
                  {item.items.reduce((n, i) => n + i.quantity, 0)} items
                </Text>
              </View>
              <OrderStatusChip status="held" />
            </View>

            <View style={styles.itemsPreview}>
              {item.items.slice(0, 3).map((line) => (
                <Text
                  key={`${item.id}-${line.menuItemId}`}
                  variant="bodySmall"
                  style={styles.itemLine}
                  numberOfLines={1}
                >
                  {line.quantity} × {line.name}
                </Text>
              ))}
              {item.items.length > 3 && (
                <Text variant="bodySmall" style={styles.more}>
                  +{item.items.length - 3} more…
                </Text>
              )}
            </View>

            <View style={styles.cardFooter}>
              <Text variant="titleMedium" style={styles.total}>
                {formatMoney(item.totalAmount)}
              </Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Button
                  mode="outlined"
                  icon="delete-outline"
                  textColor={antd.error}
                  style={styles.discardBtn}
                  onPress={() => discard(item)}
                >
                  Discard
                </Button>
                <Button
                  mode="contained"
                  icon="play"
                  style={{ borderRadius: RADIUS }}
                  onPress={() => resume(item)}
                >
                  Resume
                </Button>
              </View>
            </View>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: antd.bgLayout, padding: 16 },
  title: { color: antd.text, fontWeight: '700' },
  subtitle: { color: antd.textTertiary, marginBottom: 16 },
  list: { gap: 12, paddingBottom: 16 },
  card: {
    backgroundColor: antd.bgContainer,
    borderRadius: RADIUS,
    borderWidth: 1,
    borderColor: antd.split,
    padding: 14,
    gap: 10,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  cardTitle: { color: antd.text, fontWeight: '600' },
  cardSub: { color: antd.textTertiary },
  itemsPreview: {
    backgroundColor: antd.bgLayout,
    borderRadius: RADIUS,
    padding: 10,
    gap: 2,
  },
  itemLine: { color: antd.textSecondary },
  more: { color: antd.textTertiary },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  total: { color: antd.text, fontWeight: '700' },
  discardBtn: { borderRadius: RADIUS, borderColor: antd.errorBorder },
  empty: { alignItems: 'center', paddingTop: 60, gap: 10 },
  emptyText: { color: antd.textTertiary },
});
