import React from 'react';
import { FlatList, StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';
import { ActivityIndicator, Text, TouchableRipple } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { antd, RADIUS } from '../../theme';
import { formatMoney } from '../../utils/money';
import { DATE_PRESETS, fmtDate, type DatePreset } from '../../utils/dates';
import { listStyles } from './listStyles';
import type { HistoryRow } from './types';

interface Props {
  rows: HistoryRow[];
  loading: boolean;
  fromServer: boolean;
  search: string;
  setSearch: (v: string) => void;
  preset: DatePreset;
  setPreset: (v: DatePreset) => void;
  customFrom: string;
  setCustomFrom: (v: string) => void;
  customTo: string;
  setCustomTo: (v: string) => void;
  selectedId: string | null;
  onSelect: (row: HistoryRow) => void;
}

/** "Order History" tab: search, date presets, and the server/local order table. */
export function HistoryTabPanel({
  rows, loading, fromServer,
  search, setSearch,
  preset, setPreset,
  customFrom, setCustomFrom,
  customTo, setCustomTo,
  selectedId, onSelect,
}: Props) {
  return (
    <View style={{ flex: 1 }}>
      {/* Search */}
      <View style={styles.searchRow}>
        <View style={styles.searchBox}>
          <MaterialCommunityIcons name="magnify" size={18} color={antd.textTertiary} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search Order ID or Customer…"
            placeholderTextColor={antd.textQuaternary}
            style={styles.searchInput}
          />
        </View>
        <View style={styles.sourceTag}>
          <MaterialCommunityIcons
            name={fromServer ? 'cloud-check-outline' : 'database-outline'}
            size={14}
            color={fromServer ? antd.success : antd.warning}
          />
          <Text variant="labelSmall" style={{ color: antd.textSecondary }}>
            {fromServer ? 'Server' : 'Register'}
          </Text>
        </View>
      </View>

      {/* Date presets */}
      <View style={styles.presetRow}>
        {DATE_PRESETS.map((p) => (
          <TouchableOpacity
            key={p.value}
            onPress={() => setPreset(p.value)}
            style={[styles.presetBtn, preset === p.value && styles.presetBtnActive]}
            activeOpacity={0.7}
          >
            <Text style={[styles.presetText, preset === p.value && styles.presetTextActive]}>
              {p.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {preset === 'custom' && (
        <View style={styles.customRow}>
          <TextInput
            value={customFrom}
            onChangeText={setCustomFrom}
            placeholder="From YYYY-MM-DD"
            placeholderTextColor={antd.textQuaternary}
            style={[styles.customInput, { flex: 1 }]}
          />
          <MaterialCommunityIcons name="arrow-right" size={14} color={antd.textTertiary} />
          <TextInput
            value={customTo}
            onChangeText={setCustomTo}
            placeholder="To YYYY-MM-DD"
            placeholderTextColor={antd.textQuaternary}
            style={[styles.customInput, { flex: 1 }]}
          />
        </View>
      )}

      {/* Column headers */}
      <View style={listStyles.colHeader}>
        <Text style={[listStyles.colHdrText, { flex: 2 }]}>Order ID</Text>
        <Text style={[listStyles.colHdrText, { flex: 2 }]}>Date</Text>
        <Text style={[listStyles.colHdrText, { flex: 1, textAlign: 'right' }]}>Total Sales</Text>
      </View>

      {loading ? (
        <View style={listStyles.emptyState}><ActivityIndicator /></View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.key}
          contentContainerStyle={rows.length === 0 ? { flex: 1 } : { paddingBottom: 8 }}
          ListEmptyComponent={
            <View style={listStyles.emptyState}>
              <MaterialCommunityIcons name="receipt-text-outline" size={40} color={antd.textQuaternary} />
              <Text variant="bodyMedium" style={{ color: antd.textTertiary }}>No orders for this period</Text>
            </View>
          }
          renderItem={({ item }) => {
            const selected = item.key === selectedId;
            return (
              <TouchableRipple onPress={() => onSelect(item)} borderless>
                <View style={[listStyles.tableRow, selected && listStyles.tableRowSelected]}>
                  <Text style={[listStyles.cellTicket, { flex: 2 }]} numberOfLines={1}>
                    {item.ticket}
                  </Text>
                  <Text style={[listStyles.cellText, { flex: 2 }]} numberOfLines={1}>
                    {fmtDate(item.createdAt)}
                  </Text>
                  <Text style={[listStyles.cellAmount, { flex: 1 }]}>
                    {formatMoney(item.totalAmount)}
                  </Text>
                </View>
              </TouchableRipple>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: antd.split,
  },
  searchBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: antd.border,
    borderRadius: RADIUS,
    backgroundColor: antd.bgLayout,
    paddingHorizontal: 10,
    height: 38,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    color: antd.text,
    padding: 0,
  },
  sourceTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: RADIUS,
    borderWidth: 1,
    borderColor: antd.split,
  },
  presetRow: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: antd.split,
  },
  presetBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: RADIUS,
    borderWidth: 1,
    borderColor: antd.border,
    backgroundColor: antd.bgContainer,
  },
  presetBtnActive: {
    backgroundColor: antd.primary,
    borderColor: antd.primary,
  },
  presetText: { fontSize: 12, fontWeight: '500', color: antd.textSecondary },
  presetTextActive: { color: '#fff' },
  customRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingBottom: 8,
  },
  customInput: {
    height: 36,
    borderWidth: 1,
    borderColor: antd.border,
    borderRadius: RADIUS,
    backgroundColor: antd.bgLayout,
    paddingHorizontal: 10,
    fontSize: 12,
    color: antd.text,
  },
});
