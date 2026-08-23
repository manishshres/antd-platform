import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { Badge, Text } from 'react-native-paper';
import { antd } from '../theme';
import { useApp } from '../state/AppContext';
import { useCart } from '../state/CartContext';
import { ApiClient } from '../api/client';
import * as ordersRepo from '../db/ordersRepo';
import * as mutationsRepo from '../db/mutationsRepo';
import * as tabsRepo from '../db/tabsRepo';
import { syncEngine } from '../sync/syncEngine';
import { presetDates, type DatePreset } from '../utils/dates';
import { HistoryTabPanel } from './history/HistoryTabPanel';
import { OrdersListPanel } from './history/OrdersListPanel';
import { DetailPanel } from './history/DetailPanel';
import type { ActiveTab, DetailState, HistoryRow } from './history/types';
import type {
  Course,
  LocalOrder,
  OrderType,
  PaymentMethod,
  ServerOrder,
} from '../types';
import type { ScreenName } from '../navigation';

/**
 * Server statuses that still need someone on the floor. 'ready' and 'completed' are done
 * with the register; anything past that belongs in History, not Active.
 */
const SERVER_ACTIVE_STATUSES = ['pending', 'confirmed', 'preparing'] as const;

/** How often the Active tab re-asks the server while it is open. */
const INCOMING_POLL_MS = 20_000;

/**
 * Summary view of a server order for the Active list. Items are deliberately empty: the
 * list endpoint does not return them, and the detail is fetched on selection.
 */
function toIncomingOrder(order: ServerOrder): LocalOrder {
  return {
    id: order.id,
    serverId: order.id,
    ticketNumber: order.ticketNumber,
    status: 'incoming',
    items: [],
    customerId: null,
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    tableId: null,
    tableName: null,
    guests: null,
    orderType: (order.orderType as OrderType) ?? 'pickup',
    subtotal: order.subtotal ?? 0,
    discountId: null,
    discountName: null,
    discountAmount: 0,
    taxAmount: order.taxAmount ?? 0,
    totalAmount: order.totalAmount,
    paymentMethod: (order.paymentMethod as PaymentMethod) ?? null,
    tenderedAmount: null,
    changeAmount: null,
    tipAmount: 0,
    serviceChargeAmount: 0,
    loyaltyPointsRedeemed: 0,
    specialInstructions: null,
    errorMessage: null,
    createdAt: order.createdAt,
    syncedAt: null,
    tabOpenedAt: null,
    fireMode: 'all',
    businessDayId: null,
  };
}

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
  const [openTabs, setOpenTabs] = useState<LocalOrder[]>([]);
  const [incomingOrders, setIncomingOrders] = useState<LocalOrder[]>([]);
  const [localRefresh, setLocalRefresh] = useState(0);
  const [historyRefresh, setHistoryRefresh] = useState(0);

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
  }, [activeTab, search, online, settings.apiUrl, settings.apiKey, dataVersion, loadLocal, historyRefresh]);

  useEffect(() => {
    setHeldOrders(ordersRepo.listOrders(['held']));
    setOfflineOrders(ordersRepo.listOrders(['pending_sync', 'failed']));
    setOpenTabs(ordersRepo.listOpenTabs());
  }, [dataVersion, localRefresh]);

  /**
   * Orders that are live on the server but were never rung up here: Voice AI phone
   * orders, and anything placed on another register. The Active list read only the local
   * open_tab table, so an AI order could sit in 'pending' indefinitely with nobody on the
   * floor aware it existed — the register showed an empty Active tab while the kitchen
   * waited. Polled while the tab is open so a call that lands mid-shift appears without
   * anyone pulling to refresh.
   */
  useEffect(() => {
    // Deliberately not gated on the active tab: the count badge is the thing that tells
    // someone a phone order arrived, and it would be useless if it only updated once they
    // had already opened the tab it appears on.
    const client = new ApiClient(settings.apiUrl, settings.apiKey);
    if (!online || !client.isConfigured) {
      setIncomingOrders([]);
      return;
    }

    let cancelled = false;

    const load = () => {
      Promise.all(
        SERVER_ACTIVE_STATUSES.map((status) =>
          client.getOrders({
            status,
            limit: 50,
            // Without this an org with several branches shows every site's orders on
            // every register.
            locationId: settings.locationId || undefined,
          }),
        ),
      )
        .then((pages) => {
          if (cancelled) return;
          // Orders this device already knows about are shown from the local table, with
          // its own status; listing them twice would double-count the floor's workload.
          const knownServerIds = new Set(
            ordersRepo
              .listOrders(['synced', 'pending_sync', 'failed', 'open_tab'])
              .map((o) => o.serverId)
              .filter((id): id is string => !!id),
          );

          const merged = new Map<string, LocalOrder>();
          for (const page of pages) {
            for (const order of page.data) {
              if (knownServerIds.has(order.id)) continue;
              merged.set(order.id, toIncomingOrder(order));
            }
          }

          setIncomingOrders(
            [...merged.values()].sort((a, b) =>
              a.createdAt.localeCompare(b.createdAt),
            ),
          );
        })
        .catch(() => {
          // Offline or a flaky link: keep whatever is on screen rather than blanking the
          // list, which would read as "no orders" when it means "could not ask".
        });
    };

    load();
    const timer = setInterval(load, INCOMING_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [
    online,
    settings.apiUrl,
    settings.apiKey,
    settings.locationId,
    dataVersion,
    localRefresh,
  ]);

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

  /**
   * The Active list mixes local tabs with server-only orders. A local order carries its
   * own items; an incoming one is a summary, so its detail (and line items) has to be
   * fetched before anything useful can be shown.
   */
  const selectActiveOrder = useCallback(
    (order: LocalOrder) => {
      if (order.status !== 'incoming') {
        selectLocalOrder(order);
        return;
      }

      setSelectedId(order.id);
      setDetail({ kind: 'loading' });
      const client = new ApiClient(settings.apiUrl, settings.apiKey);
      client
        .getOrderById(order.id)
        .then((full) => setDetail({ kind: 'server', order: full }))
        .catch((err: Error) =>
          setDetail({ kind: 'error', message: err.message ?? 'Failed to load.' }),
        );
    },
    [selectLocalOrder, settings.apiUrl, settings.apiKey],
  );

  // Hold actions
  const resumeOrder = (order: LocalOrder) => {
    // An open tab reopens as a tab (baseline preserved, appends only); a held
    // order reopens as an editable draft.
    if (order.status === 'open_tab') cart.loadTab(order);
    else cart.loadOrder(order);
    onNavigate('home');
  };

  /**
   * Close out an open tab: load it into the register and go straight to tender rather
   * than dropping the server on the menu to find the pay button. The register owns the
   * tender flow (tip, split, change), so this reuses it instead of a second payment path.
   */
  const payTab = (order: LocalOrder) => {
    cart.loadTab(order);
    onNavigate('payment');
  };

  const discardOrder = (order: LocalOrder) => {
    ordersRepo.deleteOrder(order.id);
    // Drop any queued work for it too, or the sync engine would keep trying to
    // push an order that no longer exists locally.
    mutationsRepo.removeForOrder(order.id);
    syncEngine.refreshCounts();
    setLocalRefresh((n) => n + 1);
    if (selectedId === order.id) { setSelectedId(null); setDetail({ kind: 'empty' }); }
  };

  // Tab actions
  const fireCourse = (order: LocalOrder, course: Course) => {
    tabsRepo.fireCourse(order, course);
    syncEngine.refreshCounts();
    setLocalRefresh((n) => n + 1);
    // Re-read so the detail panel shows the course as fired straight away.
    const updated = ordersRepo.getOrderById(order.id);
    if (updated) setDetail({ kind: 'local', order: updated });
    if (online) syncNow();
  };

  // Offline actions
  const retrySync = (order: LocalOrder) => {
    ordersRepo.requeue(order.id);
    // The order status alone no longer drives the queue — clear the parked
    // mutations too, or the next run would skip this order entirely.
    mutationsRepo.requeueForOrder(order.id);
    syncEngine.refreshCounts();
    setLocalRefresh((n) => n + 1);
    if (online) syncNow();
  };

  const pendingCount = sync.pendingOrders + sync.failedOrders;

  // Reload the currently-open server order (its status just changed) and
  // refresh the list behind it so the voided order drops out of "paid" totals.
  const handleVoided = useCallback(() => {
    if (selectedId) {
      const client = new ApiClient(settings.apiUrl, settings.apiKey);
      client
        .getOrderById(selectedId)
        .then((order) => setDetail({ kind: 'server', order }))
        .catch((err: Error) => setDetail({ kind: 'error', message: err.message ?? 'Failed to reload.' }));
    }
    setHistoryRefresh((n) => n + 1);
  }, [selectedId, settings.apiUrl, settings.apiKey]);

  return (
    <View style={styles.root}>
      {/* ── Left panel ── */}
      <View style={styles.leftPanel}>
        {/* Tab bar */}
        <View style={styles.tabBar}>
          {(
            [
              { key: 'tabs', label: 'Active' },
              { key: 'hold', label: 'Held' },
              { key: 'offline', label: 'Unsynced' },
              { key: 'history', label: 'History' },
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
              {/* Without a count here, a phone order that arrives while the register sits
                  on another tab goes unnoticed until someone thinks to look. */}
              {tab.key === 'tabs' && incomingOrders.length > 0 && (
                <Badge size={14} style={styles.tabBadge}>{incomingOrders.length}</Badge>
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
        {activeTab === 'tabs' && (
          <OrdersListPanel
            orders={[...incomingOrders, ...openTabs]}
            selectedId={selectedId}
            onSelect={selectActiveOrder}
            emptyLabel="No active orders"
            emptyIcon="silverware-fork-knife"
          />
        )}
        {activeTab === 'hold' && (
          <OrdersListPanel
            orders={heldOrders}
            selectedId={selectedId}
            onSelect={selectLocalOrder}
            emptyLabel="No held orders"
            emptyIcon="pause-circle-outline"
          />
        )}
        {activeTab === 'offline' && (
          <OrdersListPanel
            orders={offlineOrders}
            selectedId={selectedId}
            onSelect={selectLocalOrder}
            emptyLabel="Everything is synced"
            emptyIcon="cloud-check-outline"
          />
        )}
      </View>

      {/* ── Right panel — detail ── */}
      <View style={styles.rightPanel}>
        <DetailPanel
          detail={detail}
          tab={activeTab}
          onResume={resumeOrder}
          onPayTab={payTab}
          onDiscard={discardOrder}
          onRetry={retrySync}
          onFireCourse={fireCourse}
          client={new ApiClient(settings.apiUrl, settings.apiKey)}
          onVoided={handleVoided}
          settings={settings}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row', backgroundColor: antd.bgLayout },

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
});
