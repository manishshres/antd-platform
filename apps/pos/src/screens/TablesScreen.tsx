import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, StyleSheet, View } from 'react-native';
import { Button, Dialog, Divider, Portal, Text, TouchableRipple } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { antd, RADIUS } from '../theme';
import { useApp } from '../state/AppContext';
import { useCart } from '../state/CartContext';
import * as catalogRepo from '../db/catalogRepo';
import { OrderDetailModal } from '../components/OrderDetailModal';
import { formatMoney } from '../utils/money';
import type { DiningTable } from '../types';
import type { ScreenName } from '../navigation';

type Filter = 'all' | 'vacant' | 'occupied' | 'billed' | 'reserved';

const STATUS_COLOR: Record<DiningTable['status'], string> = {
  vacant: antd.success,
  occupied: antd.error,
  billed: antd.warning,
  reserved: antd.primary,
};

const STATUS_LABEL: Record<DiningTable['status'], string> = {
  vacant: 'Available',
  occupied: 'Occupied',
  billed: 'Billed',
  reserved: 'Reserved',
};

const GUEST_CHOICES = [
  { label: '1–2', value: 2 },
  { label: '3–5', value: 5 },
  { label: '6+', value: 8 },
];

const FILTERS: { label: string; value: Filter }[] = [
  { label: 'All Tables', value: 'all' },
  { label: 'Available', value: 'vacant' },
  { label: 'Occupied', value: 'occupied' },
  { label: 'Billed', value: 'billed' },
  { label: 'Reserved', value: 'reserved' },
];

interface Props {
  onNavigate: (screen: ScreenName) => void;
}

/** Floor overview: select a table, handle conflicts on occupied/billed tables. */
export function TablesScreen({ onNavigate }: Props) {
  const { settings, online, dataVersion } = useApp();
  const cart = useCart();

  const [tables, setTables] = useState<DiningTable[]>([]);
  const [filter, setFilter] = useState<Filter>('all');

  // Guest picker state (shown for vacant tables, or after "New Ticket" on occupied)
  const [guestPick, setGuestPick] = useState<DiningTable | null>(null);
  const [guests, setGuests] = useState<number>(2);

  // Conflict dialog state (shown when tapping an occupied/billed table)
  const [conflict, setConflict] = useState<DiningTable | null>(null);

  // Order detail modal (opened from conflict dialog "View Existing Ticket")
  const [viewingOrderId, setViewingOrderId] = useState<string | null>(null);

  useEffect(() => {
    setTables(catalogRepo.getTables());
  }, [dataVersion]);

  const filtered = useMemo(
    () => tables.filter((t) => filter === 'all' || t.status === filter),
    [tables, filter],
  );

  const handleTablePress = (item: DiningTable) => {
    if (item.status === 'vacant') {
      setGuestPick(item);
      setGuests(2);
    } else if (item.status === 'occupied' || item.status === 'billed') {
      setConflict(item);
    }
    // reserved tables are informational only — no action
  };

  const confirmGuestPick = () => {
    if (!guestPick) return;
    cart.setTable(guestPick, guests);
    setGuestPick(null);
    onNavigate('home');
  };

  const openNewTicketFromConflict = () => {
    const table = conflict;
    setConflict(null);
    if (table) {
      setGuestPick(table);
      setGuests(2);
    }
  };

  return (
    <View style={styles.container}>
      {/* ── Toolbar ── */}
      <View style={styles.toolbar}>
        <View style={styles.filters}>
          {FILTERS.map((f) => (
            <TouchableRipple
              key={f.value}
              onPress={() => setFilter(f.value)}
              style={[styles.filterTab, filter === f.value && styles.filterTabActive]}
              borderless
            >
              <Text style={[styles.filterText, filter === f.value && styles.filterTextActive]}>
                {f.label}
              </Text>
            </TouchableRipple>
          ))}
        </View>
        <View style={styles.legend}>
          {(Object.keys(STATUS_COLOR) as DiningTable['status'][]).map((s) => (
            <View key={s} style={styles.legendItem}>
              <View style={[styles.dot, { backgroundColor: STATUS_COLOR[s] }]} />
              <Text variant="labelSmall" style={styles.legendText}>
                {STATUS_LABEL[s]}
              </Text>
            </View>
          ))}
        </View>
      </View>

      {/* ── Table grid ── */}
      <FlatList
        data={filtered}
        key={5}
        numColumns={5}
        keyExtractor={(item) => item.id}
        columnWrapperStyle={styles.gridRow}
        contentContainerStyle={styles.grid}
        ListEmptyComponent={
          <View style={styles.empty}>
            <MaterialCommunityIcons
              name="table-furniture"
              size={44}
              color={antd.textQuaternary}
            />
            <Text variant="bodyMedium" style={styles.emptyText}>
              {tables.length === 0
                ? 'No tables cached yet — set a location and sync.'
                : 'No tables in this state.'}
            </Text>
          </View>
        }
        renderItem={({ item }) => {
          const selected = cart.table?.id === item.id;
          const isReserved = item.status === 'reserved';
          return (
            <TouchableRipple
              onPress={() => !isReserved && handleTablePress(item)}
              disabled={isReserved}
              style={[
                styles.table,
                item.shape === 'circle' && styles.tableRound,
                { borderColor: STATUS_COLOR[item.status] },
                isReserved && styles.tableDisabled,
                selected && styles.tableSelected,
              ]}
              borderless
            >
              <View style={styles.tableInner}>
                <Text variant="titleMedium" style={styles.tableName}>
                  {item.name}
                </Text>
                <View style={styles.capacityRow}>
                  <MaterialCommunityIcons
                    name="account-outline"
                    size={14}
                    color={antd.textTertiary}
                  />
                  <Text variant="labelSmall" style={styles.capacity}>
                    {item.capacity}
                  </Text>
                </View>
                {item.status !== 'vacant' && (
                  <Text variant="labelSmall" style={[styles.statusLabel, { color: STATUS_COLOR[item.status] }]}>
                    {STATUS_LABEL[item.status]}
                  </Text>
                )}
                <View style={[styles.statusPill, { backgroundColor: STATUS_COLOR[item.status] }]} />
              </View>
            </TouchableRipple>
          );
        }}
      />

      {/* ── Current table selection bar ── */}
      {cart.table && (
        <View style={styles.selectionBar}>
          <Text variant="titleSmall" style={{ color: antd.text }}>
            Table {cart.table.name}
            {cart.guests ? `  ·  ${cart.guests} guests` : ''}
          </Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button mode="text" onPress={() => cart.setTable(null)} textColor={antd.error}>
              Clear
            </Button>
            <Button
              mode="contained"
              icon="plus"
              onPress={() => onNavigate('home')}
              style={{ borderRadius: RADIUS }}
            >
              Add Products
            </Button>
            <Button
              mode="contained"
              icon="arrow-right"
              buttonColor={antd.success}
              disabled={cart.lines.length === 0}
              onPress={() => onNavigate('payment')}
              style={{ borderRadius: RADIUS }}
            >
              Proceed to Payment
            </Button>
          </View>
        </View>
      )}

      {/* ── Guest picker dialog (vacant tables + new ticket on occupied) ── */}
      <Portal>
        <Dialog
          visible={guestPick !== null}
          onDismiss={() => setGuestPick(null)}
          style={styles.dialog}
        >
          <Dialog.Title>Select Number of Guests</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium" style={{ color: antd.textSecondary, marginBottom: 12 }}>
              Table {guestPick?.name} · seats {guestPick?.capacity}
            </Text>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              {GUEST_CHOICES.map((choice) => (
                <TouchableRipple
                  key={choice.label}
                  onPress={() => setGuests(choice.value)}
                  style={[
                    styles.guestChoice,
                    guests === choice.value && styles.guestChoiceActive,
                  ]}
                  borderless
                >
                  <Text
                    style={[
                      styles.guestChoiceText,
                      guests === choice.value && styles.guestChoiceTextActive,
                    ]}
                  >
                    {choice.label}
                  </Text>
                </TouchableRipple>
              ))}
            </View>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setGuestPick(null)}>Cancel</Button>
            <Button mode="contained" onPress={confirmGuestPick} style={{ borderRadius: RADIUS }}>
              Assign Table
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      {/* ── Conflict dialog (occupied / billed table) ── */}
      <Portal>
        <Dialog
          visible={conflict !== null}
          onDismiss={() => setConflict(null)}
          style={styles.dialog}
        >
          <Dialog.Title style={{ color: antd.text }}>Table Already Active</Dialog.Title>
          <Dialog.Content style={{ gap: 12 }}>
            <View style={styles.conflictHeader}>
              <View style={[styles.conflictStatusDot, { backgroundColor: STATUS_COLOR[conflict?.status ?? 'occupied'] }]} />
              <Text variant="titleMedium" style={{ color: antd.text, fontWeight: '700' }}>
                Table {conflict?.name}
              </Text>
              <Text variant="labelMedium" style={[styles.conflictStatusText, { color: STATUS_COLOR[conflict?.status ?? 'occupied'] }]}>
                {STATUS_LABEL[conflict?.status ?? 'occupied']}
              </Text>
            </View>
            {conflict && conflict.activeOrderTotal > 0 && (
              <View style={styles.conflictTotal}>
                <Text variant="bodySmall" style={{ color: antd.textSecondary }}>
                  Active ticket total
                </Text>
                <Text variant="titleSmall" style={{ color: antd.text, fontWeight: '700' }}>
                  {formatMoney(conflict.activeOrderTotal)}
                </Text>
              </View>
            )}
            <Divider />
            <Text variant="bodySmall" style={{ color: antd.textSecondary }}>
              This table has an open ticket. You can view it or start a separate new ticket for this table.
            </Text>
          </Dialog.Content>
          <Dialog.Actions style={styles.conflictActions}>
            <Button
              onPress={() => setConflict(null)}
              textColor={antd.textSecondary}
            >
              Cancel
            </Button>
            <Button
              mode="outlined"
              onPress={openNewTicketFromConflict}
              style={{ borderRadius: RADIUS }}
            >
              New Ticket
            </Button>
            {conflict?.activeOrderId ? (
              <Button
                mode="contained"
                icon="receipt"
                onPress={() => {
                  const id = conflict.activeOrderId;
                  setConflict(null);
                  setViewingOrderId(id);
                }}
                style={{ borderRadius: RADIUS }}
              >
                View Existing Ticket
              </Button>
            ) : null}
          </Dialog.Actions>
        </Dialog>
      </Portal>

      {/* ── Existing ticket detail modal ── */}
      <OrderDetailModal
        visible={viewingOrderId !== null}
        orderId={viewingOrderId}
        isLocal={false}
        settings={settings}
        online={online}
        onDismiss={() => setViewingOrderId(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: antd.bgLayout, padding: 16 },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  filters: { flexDirection: 'row', gap: 8 },
  filterTab: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: RADIUS,
    borderWidth: 1,
    borderColor: antd.border,
    backgroundColor: antd.bgContainer,
  },
  filterTabActive: { backgroundColor: antd.primary, borderColor: antd.primary },
  filterText: { color: antd.textSecondary, fontSize: 13, fontWeight: '500' },
  filterTextActive: { color: '#fff' },
  legend: { flexDirection: 'row', gap: 14 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { color: antd.textSecondary },

  grid: { paddingBottom: 80 },
  gridRow: { gap: 12, marginBottom: 12 },
  table: {
    flex: 1,
    maxWidth: '20%',
    aspectRatio: 1.5,
    borderRadius: RADIUS,
    borderWidth: 2,
    backgroundColor: antd.bgContainer,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  tableRound: { borderRadius: 999 },
  tableDisabled: { opacity: 0.45 },
  tableSelected: { backgroundColor: antd.primaryBg },
  tableInner: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2 },
  tableName: { color: antd.text, fontWeight: '700' },
  capacityRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  capacity: { color: antd.textTertiary },
  statusLabel: { fontSize: 10, fontWeight: '600', letterSpacing: 0.3 },
  statusPill: { width: 24, height: 4, borderRadius: 2, marginTop: 4 },

  selectionBar: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: antd.bgContainer,
    borderRadius: RADIUS,
    borderWidth: 1,
    borderColor: antd.split,
    paddingHorizontal: 16,
    paddingVertical: 10,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },

  empty: { alignItems: 'center', paddingTop: 60, gap: 10 },
  emptyText: { color: antd.textTertiary },

  dialog: {
    borderRadius: RADIUS,
    backgroundColor: antd.bgContainer,
    maxWidth: 440,
    alignSelf: 'center',
    width: '100%',
  },
  guestChoice: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: RADIUS,
    borderWidth: 1,
    borderColor: antd.border,
    alignItems: 'center',
  },
  guestChoiceActive: { borderColor: antd.primary, backgroundColor: antd.primaryBg },
  guestChoiceText: { fontSize: 16, fontWeight: '600', color: antd.textSecondary },
  guestChoiceTextActive: { color: antd.primary },

  conflictHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  conflictStatusDot: { width: 12, height: 12, borderRadius: 6 },
  conflictStatusText: { fontWeight: '600', fontSize: 13 },
  conflictTotal: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: antd.bgLayout,
    borderRadius: RADIUS,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  conflictActions: { gap: 8, paddingHorizontal: 12, paddingBottom: 8, flexWrap: 'wrap' },
});
