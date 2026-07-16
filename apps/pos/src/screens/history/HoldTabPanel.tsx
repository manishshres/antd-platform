import React from 'react';
import { FlatList, View } from 'react-native';
import { Text, TouchableRipple } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { antd } from '../../theme';
import { formatMoney } from '../../utils/money';
import { listStyles } from './listStyles';
import type { LocalOrder } from '../../types';

interface Props {
  orders: LocalOrder[];
  selectedId: string | null;
  onSelect: (o: LocalOrder) => void;
}

/** "Order On Hold" tab: parked local orders that can be resumed or discarded. */
export function HoldTabPanel({ orders, selectedId, onSelect }: Props) {
  return (
    <View style={{ flex: 1 }}>
      <View style={listStyles.colHeader}>
        <Text style={[listStyles.colHdrText, { flex: 3 }]}>Customer / Table</Text>
        <Text style={[listStyles.colHdrText, { flex: 1, textAlign: 'right' }]}>Total</Text>
      </View>
      <FlatList
        data={orders}
        keyExtractor={(o) => o.id}
        contentContainerStyle={orders.length === 0 ? { flex: 1 } : { paddingBottom: 8 }}
        ListEmptyComponent={
          <View style={listStyles.emptyState}>
            <MaterialCommunityIcons name="pause-circle-outline" size={40} color={antd.textQuaternary} />
            <Text variant="bodyMedium" style={{ color: antd.textTertiary }}>No held orders</Text>
          </View>
        }
        renderItem={({ item }) => {
          const selected = item.id === selectedId;
          return (
            <TouchableRipple onPress={() => onSelect(item)} borderless>
              <View style={[listStyles.tableRow, selected && listStyles.tableRowSelected]}>
                <View style={{ flex: 3 }}>
                  <Text style={listStyles.cellTicket} numberOfLines={1}>{item.customerName}</Text>
                  {item.tableName && (
                    <Text style={listStyles.cellSub} numberOfLines={1}>Table {item.tableName}</Text>
                  )}
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
