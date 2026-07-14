import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  FlatList,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  ActivityIndicator,
  Badge,
  Button,
  Divider,
  Text,
  TouchableRipple,
} from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { antd, RADIUS } from '../theme';
import { useApp } from '../state/AppContext';
import { useCart } from '../state/CartContext';
import { ApiClient } from '../api/client';
import * as ordersRepo from '../db/ordersRepo';
import { syncEngine } from '../sync/syncEngine';
import { formatMoney } from '../utils/money';
import { OrderStatusChip } from '../components/OrderStatusChip';
import type { LocalOrder, ServerOrderDetail } from '../types';
import type { ScreenName } from '../navigation';

// ── Types ─────────────────────────────────────────────────────────────────────

type ActiveTab = 'history' | 'hold' | 'offline';
type DatePreset = 'today' | 'yesterday' | 'week' | 'all' | 'custom';

interface HistoryRow {
  key: string;
  ticket: string;
  customerName: string;
  status: string;
  totalAmount: number;
  createdAt: string;
  local: boolean;
}

type DetailState =
  | { kind: 'empty' }
  | { kind: 'loading' }
  | { kind: 'local'; order: LocalOrder }
  | { kind: 'server'; order: ServerOrderDetail }
  | { kind: 'error'; message: string };

// ── Helpers ───────────────────────────────────────────────────────────────────

function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function presetDates(p: DatePreset): { from: string | null; to: string | null } {
  const now = new Date();
  if (p === 'today') { const s = isoDate(now); return { from: s, to: s }; }
  if (p === 'yesterday') {
    const d = new Date(now); d.setDate(d.getDate() - 1); const s = isoDate(d); return { from: s, to: s };
  }
  if (p === 'week') {
    const start = new Date(now); start.setDate(start.getDate() - start.getDay());
    return { from: isoDate(start), to: isoDate(now) };
  }
  return { from: null, to: null };
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function fmtDateOnly(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

const PRESETS: { label: string; value: DatePreset }[] = [
  { label: 'Today', value: 'today' },
  { label: 'Yesterday', value: 'yesterday' },
  { label: 'This Week', value: 'week' },
  { label: 'All', value: 'all' },
  { label: 'Custom', value: 'custom' },
];

// ── Main screen ───────────────────────────────────────────────────────────────

interface Props {
  onNavigate: (screen: ScreenName) => void;
}

export function HistoryScreen({ onNavigate }: Props) {
  const { settings, online, dataVersion, sync, syncNow } = useApp();
  const cart = useCart();

  const [activeTab, setActiveTab] = useState<ActiveTab>('history');
  const [detail, setDetail] = useState<DetailState>({ kind: 'empty' });
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // History tab
  const [search, setSearch] = useState('');
  const [preset, setPreset] = useState<DatePreset>('today');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [fromServer, setFromServer] = useState(false);

  // Hold / offline
  const [heldOrders, setHeldOrders] = useState<LocalOrder[]>([]);
  const [offlineOrders, setOfflineOrders] = useState<LocalOrder[]>([]);
  const [localRefresh, setLocalRefresh] = useState(0);

  const { from: resolvedFrom, to: resolvedTo } =
    preset === 'custom'
      ? { from: customFrom || null, to: customTo || null }
      : presetDates(preset);

  // Load history rows
  const loadLocal = useCallback((): HistoryRow[] => {
    const q = search.trim().toLowerCase();
    return ordersRepo
      .listOrders(['synced', 'pending_sync', 'failed'])
      .filter((o) => {
        if (q && !o.customerName.toLowerCase().includes(q) &&
          !String(o.ticketNumber ?? '').includes(q.replace(/^#/, ''))) return false;
        const day = o.createdAt.slice(0, 10);
        if (resolvedFrom && day < resolvedFrom) return false;
        if (resolvedTo && day > resolvedTo) return false;
        return true;
      })
      .map((o) => ({
        key: o.id,
        ticket: o.ticketNumber ? `#${o.ticketNumber}` : '—',
        customerName: o.customerName,
        status: o.status,
        totalAmount: o.totalAmount,
        createdAt: o.createdAt,
        local: true,
      }));
  }, [search, resolvedFrom, resolvedTo]);

  useEffect(() => {
    if (activeTab !== 'history') return;
    let cancelled = false;
    const client = new ApiClient(settings.apiUrl, settings.apiKey);
    if (online && client.isConfigured) {
      setLoading(true);
      client
        .getOrders({
          q: search,
          limit: 200,
          ...(resolvedFrom ? { dateFrom: resolvedFrom } : {}),
          ...(resolvedTo ? { dateTo: resolvedTo } : {}),
        })
        .then((res) => {
          if (cancelled) return;
          setFromServer(true);
          setRows(
            (res.data ?? []).map((o) => ({
              key: o.id,
              ticket: o.ticketNumber ? `#${o.ticketNumber}` : '—',
              customerName: o.customerName,
              status: o.status,
              totalAmount: o.totalAmount,
              createdAt: o.createdAt,
              local: false,
            })),
          );
        })
        .catch(() => {
          if (cancelled) return;
          setFromServer(false);
          setRows(loadLocal());
        })
        .finally(() => !cancelled && setLoading(false));
    } else {
      setFromServer(false);
      setRows(loadLocal());
    }
    return () => { cancelled = true; };
  }, [activeTab, search, online, settings.apiUrl, settings.apiKey, dataVersion, loadLocal]);

  useEffect(() => {
    setHeldOrders(ordersRepo.listOrders(['held']));
    setOfflineOrders(ordersRepo.listOrders(['pending_sync', 'failed']));
  }, [dataVersion, localRefresh]);

  // Clear selection on tab change
  useEffect(() => {
    setSelectedId(null);
    setDetail({ kind: 'empty' });
  }, [activeTab]);

  // Select handlers
  const selectHistoryRow = useCallback(
    (row: HistoryRow) => {
      setSelectedId(row.key);
      if (row.local) {
        const order = ordersRepo.getOrderById(row.key);
        setDetail(order ? { kind: 'local', order } : { kind: 'error', message: 'Order not found.' });
      } else {
        setDetail({ kind: 'loading' });
        const client = new ApiClient(settings.apiUrl, settings.apiKey);
        client
          .getOrderById(row.key)
          .then((order) => setDetail({ kind: 'server', order }))
          .catch((err: Error) => setDetail({ kind: 'error', message: err.message ?? 'Failed to load.' }));
      }
    },
    [settings.apiUrl, settings.apiKey],
  );

  const selectLocalOrder = useCallback((order: LocalOrder) => {
    setSelectedId(order.id);
    setDetail({ kind: 'local', order });
  }, []);

  // Hold actions
  const resumeOrder = (order: LocalOrder) => {
    cart.loadOrder(order);
    onNavigate('home');
  };

  const discardOrder = (order: LocalOrder) => {
    ordersRepo.deleteOrder(order.id);
    syncEngine.refreshCounts();
    setLocalRefresh((n) => n + 1);
    if (selectedId === order.id) { setSelectedId(null); setDetail({ kind: 'empty' }); }
  };

  // Offline actions
  const retrySync = (order: LocalOrder) => {
    ordersRepo.requeue(order.id);
    syncEngine.refreshCounts();
    setLocalRefresh((n) => n + 1);
    if (online) syncNow();
  };

  const pendingCount = sync.pendingOrders + sync.failedOrders;

  return (
    <View style={styles.root}>
      {/* ── Left panel ── */}
      <View style={styles.leftPanel}>
        {/* Tab bar */}
        <View style={styles.tabBar}>
          {(
            [
              { key: 'history', label: 'Order History' },
              { key: 'hold', label: 'Order On Hold' },
              { key: 'offline', label: 'Offline Order' },
            ] as { key: ActiveTab; label: string }[]
          ).map((tab) => (
            <TouchableOpacity
              key={tab.key}
              onPress={() => setActiveTab(tab.key)}
              style={[styles.tab, activeTab === tab.key && styles.tabActive]}
              activeOpacity={0.75}
            >
              <Text style={[styles.tabText, activeTab === tab.key && styles.tabTextActive]}>
                {tab.label}
              </Text>
              {tab.key === 'offline' && pendingCount > 0 && (
                <Badge size={14} style={styles.tabBadge}>{pendingCount}</Badge>
              )}
            </TouchableOpacity>
          ))}
        </View>

        {activeTab === 'history' && (
          <HistoryTabPanel
            rows={rows}
            loading={loading}
            fromServer={fromServer}
            search={search}
            setSearch={setSearch}
            preset={preset}
            setPreset={setPreset}
            customFrom={customFrom}
            setCustomFrom={setCustomFrom}
            customTo={customTo}
            setCustomTo={setCustomTo}
            selectedId={selectedId}
            onSelect={selectHistoryRow}
          />
        )}
        {activeTab === 'hold' && (
          <HoldTabPanel
            orders={heldOrders}
            selectedId={selectedId}
            onSelect={selectLocalOrder}
          />
        )}
        {activeTab === 'offline' && (
          <OfflineTabPanel
            orders={offlineOrders}
            online={online}
            onSyncNow={() => { if (online) syncNow(); }}
            selectedId={selectedId}
            onSelect={selectLocalOrder}
          />
        )}
      </View>

      {/* ── Right panel — detail ── */}
      <View style={styles.rightPanel}>
        <DetailPanel
          detail={detail}
          tab={activeTab}
          onResume={resumeOrder}
          onDiscard={discardOrder}
          onRetry={retrySync}
        />
      </View>
    </View>
  );
}

// ── History tab ───────────────────────────────────────────────────────────────

interface HistoryTabPanelProps {
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

function HistoryTabPanel({
  rows, loading, fromServer,
  search, setSearch,
  preset, setPreset,
  customFrom, setCustomFrom,
  customTo, setCustomTo,
  selectedId, onSelect,
}: HistoryTabPanelProps) {
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
        {PRESETS.map((p) => (
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
      <View style={styles.colHeader}>
        <Text style={[styles.colHdrText, { flex: 2 }]}>Order ID</Text>
        <Text style={[styles.colHdrText, { flex: 2 }]}>Date</Text>
        <Text style={[styles.colHdrText, { flex: 1, textAlign: 'right' }]}>Total Sales</Text>
      </View>

      {loading ? (
        <View style={styles.emptyState}><ActivityIndicator /></View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.key}
          contentContainerStyle={rows.length === 0 ? { flex: 1 } : { paddingBottom: 8 }}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <MaterialCommunityIcons name="receipt-text-outline" size={40} color={antd.textQuaternary} />
              <Text variant="bodyMedium" style={{ color: antd.textTertiary }}>No orders for this period</Text>
            </View>
          }
          renderItem={({ item }) => {
            const selected = item.key === selectedId;
            return (
              <TouchableRipple onPress={() => onSelect(item)} borderless>
                <View style={[styles.tableRow, selected && styles.tableRowSelected]}>
                  <Text style={[styles.cellTicket, { flex: 2 }]} numberOfLines={1}>
                    {item.ticket}
                  </Text>
                  <Text style={[styles.cellText, { flex: 2 }]} numberOfLines={1}>
                    {fmtDate(item.createdAt)}
                  </Text>
                  <Text style={[styles.cellAmount, { flex: 1 }]}>
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

// ── Hold tab ──────────────────────────────────────────────────────────────────

function HoldTabPanel({
  orders, selectedId, onSelect,
}: { orders: LocalOrder[]; selectedId: string | null; onSelect: (o: LocalOrder) => void }) {
  return (
    <View style={{ flex: 1 }}>
      <View style={styles.colHeader}>
        <Text style={[styles.colHdrText, { flex: 3 }]}>Customer / Table</Text>
        <Text style={[styles.colHdrText, { flex: 1, textAlign: 'right' }]}>Total</Text>
      </View>
      <FlatList
        data={orders}
        keyExtractor={(o) => o.id}
        contentContainerStyle={orders.length === 0 ? { flex: 1 } : { paddingBottom: 8 }}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <MaterialCommunityIcons name="pause-circle-outline" size={40} color={antd.textQuaternary} />
            <Text variant="bodyMedium" style={{ color: antd.textTertiary }}>No held orders</Text>
          </View>
        }
        renderItem={({ item }) => {
          const selected = item.id === selectedId;
          return (
            <TouchableRipple onPress={() => onSelect(item)} borderless>
              <View style={[styles.tableRow, selected && styles.tableRowSelected]}>
                <View style={{ flex: 3 }}>
                  <Text style={styles.cellTicket} numberOfLines={1}>{item.customerName}</Text>
                  {item.tableName && (
                    <Text style={styles.cellSub} numberOfLines={1}>Table {item.tableName}</Text>
                  )}
                </View>
                <Text style={[styles.cellAmount, { flex: 1 }]}>{formatMoney(item.totalAmount)}</Text>
              </View>
            </TouchableRipple>
          );
        }}
      />
    </View>
  );
}

// ── Offline tab ───────────────────────────────────────────────────────────────

function OfflineTabPanel({
  orders, online, onSyncNow, selectedId, onSelect,
}: {
  orders: LocalOrder[];
  online: boolean;
  onSyncNow: () => void;
  selectedId: string | null;
  onSelect: (o: LocalOrder) => void;
}) {
  return (
    <View style={{ flex: 1 }}>
      {online && (
        <TouchableOpacity onPress={onSyncNow} style={styles.syncBanner} activeOpacity={0.8}>
          <MaterialCommunityIcons name="cloud-sync-outline" size={16} color={antd.primary} />
          <Text style={{ color: antd.primary, fontSize: 13, fontWeight: '500' }}>Sync Now</Text>
        </TouchableOpacity>
      )}
      <View style={styles.colHeader}>
        <Text style={[styles.colHdrText, { flex: 3 }]}>Customer</Text>
        <Text style={[styles.colHdrText, { flex: 1 }]}>Status</Text>
        <Text style={[styles.colHdrText, { flex: 1, textAlign: 'right' }]}>Total</Text>
      </View>
      <FlatList
        data={orders}
        keyExtractor={(o) => o.id}
        contentContainerStyle={orders.length === 0 ? { flex: 1 } : { paddingBottom: 8 }}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <MaterialCommunityIcons name="cloud-check-outline" size={40} color={antd.success} />
            <Text variant="bodyMedium" style={{ color: antd.textTertiary }}>All orders synced</Text>
          </View>
        }
        renderItem={({ item }) => {
          const selected = item.id === selectedId;
          return (
            <TouchableRipple onPress={() => onSelect(item)} borderless>
              <View style={[styles.tableRow, selected && styles.tableRowSelected]}>
                <Text style={[styles.cellTicket, { flex: 3 }]} numberOfLines={1}>{item.customerName}</Text>
                <View style={{ flex: 1 }}>
                  <OrderStatusChip status={item.status} />
                </View>
                <Text style={[styles.cellAmount, { flex: 1 }]}>{formatMoney(item.totalAmount)}</Text>
              </View>
            </TouchableRipple>
          );
        }}
      />
    </View>
  );
}

// ── Detail panel ──────────────────────────────────────────────────────────────

interface DetailPanelProps {
  detail: DetailState;
  tab: ActiveTab;
  onResume: (o: LocalOrder) => void;
  onDiscard: (o: LocalOrder) => void;
  onRetry: (o: LocalOrder) => void;
}

function DetailPanel({ detail, tab, onResume, onDiscard, onRetry }: DetailPanelProps) {
  if (detail.kind === 'empty') {
    return (
      <View style={styles.detailEmpty}>
        <MaterialCommunityIcons name="receipt-text-outline" size={48} color={antd.textQuaternary} />
        <Text variant="bodyMedium" style={{ color: antd.textTertiary, marginTop: 12 }}>
          Select an order to view details
        </Text>
      </View>
    );
  }

  if (detail.kind === 'loading') {
    return <View style={styles.detailEmpty}><ActivityIndicator /></View>;
  }

  if (detail.kind === 'error') {
    return (
      <View style={styles.detailEmpty}>
        <MaterialCommunityIcons name="alert-circle-outline" size={40} color={antd.error} />
        <Text variant="bodyMedium" style={{ color: antd.textTertiary, marginTop: 8 }}>{detail.message}</Text>
      </View>
    );
  }

  if (detail.kind === 'local') {
    const o = detail.order;
    return (
      <ScrollView style={styles.detailScroll} contentContainerStyle={styles.detailContent}>
        <LocalOrderDetail
          order={o}
          tab={tab}
          onResume={onResume}
          onDiscard={onDiscard}
          onRetry={onRetry}
        />
      </ScrollView>
    );
  }

  // server
  const o = detail.order;
  return (
    <ScrollView style={styles.detailScroll} contentContainerStyle={styles.detailContent}>
      <ServerOrderDetailView order={o} />
    </ScrollView>
  );
}

// ── Local order detail ────────────────────────────────────────────────────────

function LocalOrderDetail({
  order, tab, onResume, onDiscard, onRetry,
}: {
  order: LocalOrder;
  tab: ActiveTab;
  onResume: (o: LocalOrder) => void;
  onDiscard: (o: LocalOrder) => void;
  onRetry: (o: LocalOrder) => void;
}) {
  const ticket = order.ticketNumber ? `#${order.ticketNumber}` : order.id.slice(0, 8).toUpperCase();
  const tableLabel = order.tableName
    ? `${order.orderType === 'dine_in' ? 'Dine-In' : 'Pickup'} • Table ${order.tableName}`
    : order.orderType === 'dine_in' ? 'Dine-In' : 'Pickup';

  return (
    <>
      <View style={styles.detailHeader}>
        <Text variant="titleMedium" style={styles.detailOrderId}>Order {ticket}</Text>
        <Text variant="bodySmall" style={{ color: antd.textTertiary }}>{fmtDateOnly(order.createdAt)}</Text>
      </View>

      <Text variant="bodyMedium" style={styles.detailMeta}>
        {order.customerName}{'  '}
        <Text style={{ color: antd.textTertiary }}>{tableLabel}</Text>
      </Text>

      {order.specialInstructions ? (
        <Text variant="bodySmall" style={styles.detailNote}>"{order.specialInstructions}"</Text>
      ) : null}

      <Divider style={styles.div} />

      {order.items.map((item, i) => (
        <View key={`${item.menuItemId}-${i}`} style={styles.lineItem}>
          <Text style={styles.lineIdx}>{i + 1}.</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.lineName}>{item.name}</Text>
            {item.notes ? <Text style={styles.lineNote}>{item.notes}</Text> : null}
          </View>
          <Text style={styles.lineQty}>×{item.quantity}</Text>
          <Text style={styles.linePrice}>{formatMoney(item.unitPrice * item.quantity)}</Text>
        </View>
      ))}

      <Divider style={styles.div} />

      <TotalRow label="Subtotal" value={formatMoney(order.subtotal)} />
      {order.discountAmount > 0 && (
        <TotalRow label={order.discountName ?? 'Discount'} value={`-${formatMoney(order.discountAmount)}`} accent />
      )}
      <TotalRow label="Tax" value={formatMoney(order.taxAmount)} />
      <TotalRow label="Grand Total" value={formatMoney(order.totalAmount)} bold />

      {order.paymentMethod && (
        <>
          <Divider style={styles.div} />
          <TotalRow label={order.paymentMethod === 'cash' ? 'Cash' : 'Card'} value={formatMoney(order.tenderedAmount)} />
          {order.changeAmount != null && order.changeAmount > 0 && (
            <TotalRow label="Change" value={formatMoney(order.changeAmount)} />
          )}
        </>
      )}

      {order.errorMessage ? (
        <View style={styles.errorBox}>
          <MaterialCommunityIcons name="alert-circle-outline" size={14} color={antd.error} />
          <Text style={styles.errorText}>{order.errorMessage}</Text>
        </View>
      ) : null}

      <View style={styles.actionRow}>
        {tab === 'hold' && (
          <>
            <Button
              mode="contained"
              onPress={() => onResume(order)}
              style={[styles.actionBtn, { flex: 1 }]}
              contentStyle={styles.actionBtnContent}
            >
              Resume Order
            </Button>
            <Button
              mode="outlined"
              onPress={() =>
                Alert.alert('Discard Order', 'Remove this held order?', [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Discard', style: 'destructive', onPress: () => onDiscard(order) },
                ])
              }
              style={styles.actionBtn}
              contentStyle={styles.actionBtnContent}
              textColor={antd.error}
            >
              Discard
            </Button>
          </>
        )}
        {tab === 'offline' && order.status === 'failed' && (
          <Button
            mode="contained"
            onPress={() => onRetry(order)}
            style={[styles.actionBtn, { flex: 1 }]}
            contentStyle={styles.actionBtnContent}
            icon="refresh"
          >
            Retry Sync
          </Button>
        )}
      </View>
    </>
  );
}

// ── Server order detail ───────────────────────────────────────────────────────

function ServerOrderDetailView({ order }: { order: ServerOrderDetail }) {
  const name = order.customer?.name ?? order.customerName;
  const tableLabel = order.table?.name
    ? `${order.orderType === 'dine_in' ? 'Dine-In' : 'Pickup'} • Table ${order.table.name}`
    : order.orderType === 'dine_in' ? 'Dine-In' : 'Pickup';

  return (
    <>
      <View style={styles.detailHeader}>
        <Text variant="titleMedium" style={styles.detailOrderId}>
          Order {order.ticketNumber ? `#${order.ticketNumber}` : '—'}
        </Text>
        <OrderStatusChip status={order.status} />
      </View>

      <Text variant="bodySmall" style={{ color: antd.textTertiary, marginBottom: 4 }}>
        {fmtDateOnly(order.createdAt)}
      </Text>

      <Text variant="bodyMedium" style={styles.detailMeta}>
        {name}{'  '}
        <Text style={{ color: antd.textTertiary }}>{tableLabel}</Text>
      </Text>

      {order.specialInstructions ? (
        <Text variant="bodySmall" style={styles.detailNote}>"{order.specialInstructions}"</Text>
      ) : null}

      <Divider style={styles.div} />

      {order.items.map((item, i) => (
        <View key={item.id} style={styles.lineItem}>
          <Text style={styles.lineIdx}>{i + 1}.</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.lineName}>{item.name}</Text>
            {item.notes ? <Text style={styles.lineNote}>{item.notes}</Text> : null}
          </View>
          <Text style={styles.lineQty}>×{item.quantity}</Text>
          <Text style={styles.linePrice}>{formatMoney(item.unitPrice * item.quantity)}</Text>
        </View>
      ))}

      <Divider style={styles.div} />

      <TotalRow label="Subtotal" value={formatMoney(order.subtotal)} />
      {(order.discountAmount ?? 0) > 0 && (
        <TotalRow label="Discount" value={`-${formatMoney(order.discountAmount)}`} accent />
      )}
      <TotalRow label="Tax" value={formatMoney(order.taxAmount)} />
      <TotalRow label="Grand Total" value={formatMoney(order.totalAmount)} bold />

      {order.paymentMethod && (
        <>
          <Divider style={styles.div} />
          <TotalRow label={order.paymentMethod === 'cash' ? 'Cash' : 'Card'} value={formatMoney(order.tenderedAmount)} />
          {(order.changeAmount ?? 0) > 0 && (
            <TotalRow label="Balance" value={formatMoney(order.changeAmount)} />
          )}
        </>
      )}

      <TouchableOpacity
        style={styles.printBtn}
        activeOpacity={0.8}
        onPress={() => Alert.alert('Print Invoice', 'Connect a receipt printer in Settings to enable printing.')}
      >
        <MaterialCommunityIcons name="printer-outline" size={18} color="#fff" />
        <Text style={styles.printBtnText}>Print Invoice</Text>
      </TouchableOpacity>
    </>
  );
}

// ── Shared sub-components ─────────────────────────────────────────────────────

function TotalRow({
  label, value, bold, accent,
}: { label: string; value: string; bold?: boolean; accent?: boolean }) {
  return (
    <View style={styles.totalRow}>
      <Text style={[styles.totalLabel, bold && styles.totalBold]}>{label}</Text>
      <Text style={[styles.totalValue, bold && styles.totalBold, accent && { color: antd.success }]}>
        {value}
      </Text>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row', backgroundColor: antd.bgLayout },

  // ── Layout panels ──
  leftPanel: {
    flex: 55,
    borderRightWidth: 1,
    borderRightColor: antd.split,
    backgroundColor: antd.bgContainer,
  },
  rightPanel: {
    flex: 45,
    backgroundColor: antd.bgContainer,
  },

  // ── Tab bar ──
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: antd.split,
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
    position: 'relative',
  },
  tabActive: {
    borderBottomColor: antd.primary,
  },
  tabText: {
    fontSize: 13,
    fontWeight: '500',
    color: antd.textSecondary,
  },
  tabTextActive: {
    color: antd.primary,
    fontWeight: '600',
  },
  tabBadge: {
    position: 'absolute',
    top: 6,
    right: 8,
    backgroundColor: antd.error,
  },

  // ── Search ──
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

  // ── Preset row ──
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

  // ── Custom date row ──
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

  // ── Column headers ──
  colHeader: {
    flexDirection: 'row',
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: antd.bgLayout,
    borderBottomWidth: 1,
    borderBottomColor: antd.split,
  },
  colHdrText: {
    fontSize: 11,
    fontWeight: '600',
    color: antd.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  // ── Table rows ──
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: antd.split,
  },
  tableRowSelected: {
    backgroundColor: antd.primaryBg,
  },
  cellTicket: { fontSize: 13, fontWeight: '600', color: antd.primary },
  cellText: { fontSize: 13, color: antd.text },
  cellAmount: { fontSize: 13, fontWeight: '600', color: antd.text, textAlign: 'right' },
  cellSub: { fontSize: 11, color: antd.textTertiary, marginTop: 2 },

  // ── Sync banner ──
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

  // ── Empty / loading states ──
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
    gap: 10,
  },

  // ── Right panel detail ──
  detailEmpty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 24,
  },
  detailScroll: { flex: 1 },
  detailContent: { padding: 20, paddingBottom: 32 },

  detailHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  detailOrderId: { fontWeight: '700', color: antd.text },
  detailMeta: { color: antd.text, marginBottom: 4 },
  detailNote: { color: antd.textSecondary, fontStyle: 'italic', marginBottom: 4 },

  div: { marginVertical: 12, backgroundColor: antd.split },

  // ── Line items ──
  lineItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginBottom: 8,
  },
  lineIdx: { fontSize: 13, color: antd.textTertiary, width: 18 },
  lineName: { fontSize: 13, color: antd.text, fontWeight: '500' },
  lineNote: { fontSize: 11, color: antd.textTertiary, marginTop: 1 },
  lineQty: { fontSize: 13, color: antd.textSecondary, minWidth: 28, textAlign: 'right' },
  linePrice: { fontSize: 13, fontWeight: '600', color: antd.text, minWidth: 64, textAlign: 'right' },

  // ── Totals ──
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  totalLabel: { fontSize: 13, color: antd.textSecondary },
  totalValue: { fontSize: 13, color: antd.text, fontWeight: '500' },
  totalBold: { fontSize: 15, fontWeight: '700', color: antd.text },

  // ── Error box ──
  errorBox: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'flex-start',
    backgroundColor: antd.errorBg,
    borderRadius: RADIUS,
    padding: 10,
    marginTop: 12,
    borderWidth: 1,
    borderColor: antd.errorBorder,
  },
  errorText: { flex: 1, fontSize: 12, color: antd.error },

  // ── Actions ──
  actionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 20,
  },
  actionBtn: { borderRadius: RADIUS },
  actionBtnContent: { paddingVertical: 4 },

  // ── Print button ──
  printBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 20,
    paddingVertical: 14,
    borderRadius: RADIUS,
    backgroundColor: antd.primary,
  },
  printBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
