import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { Badge, Text } from 'react-native-paper';
import { antd } from '../theme';
import { useApp } from '../state/AppContext';
import { useCart } from '../state/CartContext';
import { ApiClient } from '../api/client';
import * as ordersRepo from '../db/ordersRepo';
import { syncEngine } from '../sync/syncEngine';
import { presetDates, type DatePreset } from '../utils/dates';
import { HistoryTabPanel } from './history/HistoryTabPanel';
import { HoldTabPanel } from './history/HoldTabPanel';
import { OfflineTabPanel } from './history/OfflineTabPanel';
import { DetailPanel } from './history/DetailPanel';
import type { ActiveTab, DetailState, HistoryRow } from './history/types';
import type { LocalOrder } from '../types';
import type { ScreenName } from '../navigation';

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
