import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Button, Dialog, Divider, Portal, Text, TouchableRipple } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { antd, RADIUS } from '../theme';
import { useApp } from '../state/AppContext';
import { useCart } from '../state/CartContext';
import * as catalogRepo from '../db/catalogRepo';
import * as tabsRepo from '../db/tabsRepo';
import { OrderDetailModal } from '../components/OrderDetailModal';
import { TableManagerModal } from '../components/TableManagerModal';
import { FloorPlanCanvas } from '../components/FloorPlanCanvas';
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
  const { settings, online, dataVersion, syncNow } = useApp();
  const cart = useCart();

  const [tables, setTables] = useState<DiningTable[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [managingLayout, setManagingLayout] = useState(false);
  const [viewMode, setViewMode] = useState<'grid' | 'floor'>('grid');
  const [activeFloorPlanId, setActiveFloorPlanId] = useState<string | null>(null);
  const [canvasWidth, setCanvasWidth] = useState(0);

  // Guest picker state (shown for vacant tables, or after "New Ticket" on occupied)
  const [guestPick, setGuestPick] = useState<DiningTable | null>(null);
  const [guests, setGuests] = useState<number>(2);

  // Conflict dialog state (shown when tapping an occupied/billed table)
  const [conflict, setConflict] = useState<DiningTable | null>(null);

  // Order detail modal (opened from conflict dialog "View Existing Ticket")
  const [viewingOrderId, setViewingOrderId] = useState<string | null>(null);
  const [viewingOrderIsLocal, setViewingOrderIsLocal] = useState(false);

  useEffect(() => {
    setTables(catalogRepo.getTables());
  }, [dataVersion]);

  const filtered = useMemo(
    () => tables.filter((t) => filter === 'all' || t.status === filter),
    [tables, filter],
  );

  const floorPlans = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of tables) map.set(t.floorPlanId, t.floorPlanName);
    return Array.from(map, ([id, name]) => ({ id, name }));
  }, [tables]);

  useEffect(() => {
    setActiveFloorPlanId((prev) =>
      prev && floorPlans.some((p) => p.id === prev) ? prev : (floorPlans[0]?.id ?? null),
    );
  }, [floorPlans]);

  const floorTables = useMemo(
    () => filtered.filter((t) => t.floorPlanId === activeFloorPlanId),
    [filtered, activeFloorPlanId],
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

  /**
   * Open the order detail modal for a table's active tab. A tab opened on
   * *this* device has a local row — that's the source of truth (it may hold
   * appends the server hasn't seen yet) and must be looked up locally, not
   * via the server API. Only a tab opened on another register (no local row
   * here) falls back to the server, keyed by the table's server-side
   * activeOrderId. Getting this wrong is exactly the old "Order not found"
   * bug: it always queried the server, so any tab rung up on this device
   * (whose local id the server has never heard of) 404'd.
   */
  const viewTab = (table: DiningTable) => {
    const tab = tabsRepo.findOpenTabForTable(table.id);
    if (tab) {
      setViewingOrderIsLocal(true);
      setViewingOrderId(tab.id);
    } else if (table.activeOrderId) {
      setViewingOrderIsLocal(false);
      setViewingOrderId(table.activeOrderId);
    }
  };

  /**
   * Resume the tab already on this table. Prefer the local row — it has the
   * item lines and may hold appends the server hasn't seen yet; the server's
   * activeOrderId only tells us a tab exists.
   */
  const addToTabFromConflict = () => {
    const table = conflict;
    setConflict(null);
    if (!table) return;
    const tab = tabsRepo.findOpenTabForTable(table.id);
    if (tab) {
      cart.loadTab(tab);
      onNavigate('home');
      return;
    }
    // Tab was opened on another register: we know it exists but not what's on
    // it. Show it rather than silently starting a second check on the table.
    viewTab(table);
  };

  /**
   * Close out the table: load its open tab into the cart and go straight to
   * payment. Only possible for a tab with a local row — settling requires the
   * item lines, which a tab opened on another register isn't holding here; for
   * that case we fall back to viewing it.
   */
  const closeTabAndPay = () => {
    const table = conflict;
    setConflict(null);
    if (!table) return;
    const tab = tabsRepo.findOpenTabForTable(table.id);
    if (tab) {
      cart.loadTab(tab);
      onNavigate('payment');
      return;
    }
    viewTab(table);
  };

  return (
    <View style={styles.container}>
      {/* ── Toolbar ── */}
      <View style={styles.toolbar}>
        <View style={styles.toolbarRow}>
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
          <Button
            mode="outlined"
            icon={viewMode === 'grid' ? 'floor-plan' : 'view-grid-outline'}
            compact
            onPress={() => setViewMode((v) => (v === 'grid' ? 'floor' : 'grid'))}
            style={styles.manageButton}
          >
            {viewMode === 'grid' ? 'Floor View' : 'Grid View'}
          </Button>
          <Button
            mode="outlined"
            icon="pencil-ruler-outline"
            compact
            onPress={() => setManagingLayout(true)}
            style={styles.manageButton}
          >
            Manage Layout
          </Button>
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

      {viewMode === 'floor' && floorPlans.length > 1 && (
        <View style={styles.floorPlanTabs}>
          {floorPlans.map((p) => (
            <TouchableRipple
              key={p.id}
              onPress={() => setActiveFloorPlanId(p.id)}
              style={[styles.floorPlanTab, activeFloorPlanId === p.id && styles.floorPlanTabActive]}
              borderless
            >
              <Text
                style={[
                  styles.floorPlanTabText,
                  activeFloorPlanId === p.id && styles.floorPlanTabTextActive,
                ]}
              >
                {p.name}
              </Text>
            </TouchableRipple>
          ))}
        </View>
      )}

      {/* ── Table grid / floor view ── */}
      <View style={styles.listContainer}>
        {viewMode === 'floor' ? (
          <View
            style={{ flex: 1 }}
            onLayout={(e) => setCanvasWidth(e.nativeEvent.layout.width - 20)}
          >
            {canvasWidth > 0 && (
              <FloorPlanCanvas
                tables={floorTables}
                floorWidth={floorTables[0]?.floorPlanWidth ?? 800}
                floorHeight={floorTables[0]?.floorPlanHeight ?? 600}
                containerWidth={canvasWidth}
                colorFor={(t) => STATUS_COLOR[t.status]}
                selectedTableId={cart.table?.id ?? null}
                onPressTable={(t) => t.status !== 'reserved' && handleTablePress(t)}
              />
            )}
          </View>
        ) : (
        <FlashList
          data={filtered}
          numColumns={5}
          estimatedItemSize={120}
          keyExtractor={(item) => item.id}
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
            <View style={styles.gridCell}>
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
            </View>
          );
        }}
      />
        )}
      </View>

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
              This table has an open tab. Add the new items to it, or view what
              is on it so far.
            </Text>
          </Dialog.Content>
          <Dialog.Actions style={styles.conflictActions}>
            <Button
              onPress={() => setConflict(null)}
              textColor={antd.textSecondary}
            >
              Cancel
            </Button>
            {conflict?.activeOrderId ? (
              <Button
                mode="outlined"
                icon="receipt"
                onPress={() => {
                  const table = conflict;
                  setConflict(null);
                  viewTab(table);
                }}
                style={{ borderRadius: RADIUS }}
              >
                View Tab
              </Button>
            ) : null}
            <Button
              mode="outlined"
              icon="plus"
              onPress={addToTabFromConflict}
              style={{ borderRadius: RADIUS }}
            >
              Add to Tab
            </Button>
            <Button
              mode="contained"
              icon="cash-register"
              buttonColor={antd.success}
              onPress={closeTabAndPay}
              style={{ borderRadius: RADIUS }}
            >
              Close Tab &amp; Pay
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      {/* ── Existing ticket detail modal ── */}
      <OrderDetailModal
        visible={viewingOrderId !== null}
        orderId={viewingOrderId}
        isLocal={viewingOrderIsLocal}
        settings={settings}
        online={online}
        onDismiss={() => setViewingOrderId(null)}
      />

      {/* ── Floor plan / table structural editor ── */}
      <TableManagerModal
        visible={managingLayout}
        onDismiss={() => setManagingLayout(false)}
        settings={settings}
        tables={tables}
        onMutated={syncNow}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: antd.bgLayout, padding: 16 },
  toolbar: {
    gap: 10,
    marginBottom: 16,
  },
  toolbarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  manageButton: { borderRadius: RADIUS, flexShrink: 0 },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, flexShrink: 1 },
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
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { color: antd.textSecondary },

  floorPlanTabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  floorPlanTab: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: RADIUS,
    borderWidth: 1,
    borderColor: antd.border,
    backgroundColor: antd.bgContainer,
  },
  floorPlanTabActive: { backgroundColor: antd.primary, borderColor: antd.primary },
  floorPlanTabText: { color: antd.textSecondary, fontSize: 13, fontWeight: '500' },
  floorPlanTabTextActive: { color: '#fff' },

  listContainer: { flex: 1 },
  grid: { paddingBottom: 80, paddingHorizontal: 10 },
  gridCell: { width: '100%', paddingHorizontal: 6, paddingBottom: 12 },
  table: {
    flex: 1,
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
