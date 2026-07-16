import React from 'react';
import { FlatList, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Text, TouchableRipple } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { antd, RADIUS } from '../../theme';
import { formatMoney } from '../../utils/money';
import { OrderStatusChip } from '../../components/OrderStatusChip';
import { listStyles } from './listStyles';
import type { LocalOrder } from '../../types';

interface Props {
  orders: LocalOrder[];
  online: boolean;
  onSyncNow: () => void;
  selectedId: string | null;
  onSelect: (o: LocalOrder) => void;
}

/** "Offline Order" tab: queued/failed orders awaiting sync to the server. */
export function OfflineTabPanel({ orders, online, onSyncNow, selectedId, onSelect }: Props) {
  return (
    <View style={{ flex: 1 }}>
      {online && (
        <TouchableOpacity onPress={onSyncNow} style={styles.syncBanner} activeOpacity={0.8}>
          <MaterialCommunityIcons name="cloud-sync-outline" size={16} color={antd.primary} />
          <Text style={{ color: antd.primary, fontSize: 13, fontWeight: '500' }}>Sync Now</Text>
        </TouchableOpacity>
      )}
      <View style={listStyles.colHeader}>
        <Text style={[listStyles.colHdrText, { flex: 3 }]}>Customer</Text>
        <Text style={[listStyles.colHdrText, { flex: 1 }]}>Status</Text>
        <Text style={[listStyles.colHdrText, { flex: 1, textAlign: 'right' }]}>Total</Text>
      </View>
      <FlatList
        data={orders}
        keyExtractor={(o) => o.id}
        contentContainerStyle={orders.length === 0 ? { flex: 1 } : { paddingBottom: 8 }}
        ListEmptyComponent={
          <View style={listStyles.emptyState}>
            <MaterialCommunityIcons name="cloud-check-outline" size={40} color={antd.success} />
            <Text variant="bodyMedium" style={{ color: antd.textTertiary }}>All orders synced</Text>
          </View>
        }
        renderItem={({ item }) => {
          const selected = item.id === selectedId;
          return (
            <TouchableRipple onPress={() => onSelect(item)} borderless>
              <View style={[listStyles.tableRow, selected && listStyles.tableRowSelected]}>
                <Text style={[listStyles.cellTicket, { flex: 3 }]} numberOfLines={1}>{item.customerName}</Text>
                <View style={{ flex: 1 }}>
                  <OrderStatusChip status={item.status} />
                </View>
                <Text style={[listStyles.cellAmount, { flex: 1 }]}>{formatMoney(item.totalAmount)}</Text>
              </View>
            </TouchableRipple>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  syncBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    margin: 10,
    padding: 8,
    borderRadius: RADIUS,
    backgroundColor: antd.primaryBg,
    borderWidth: 1,
    borderColor: antd.primaryBorder,
    justifyContent: 'center',
  },
});
