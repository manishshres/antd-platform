import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { Button, Text } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { antd, RADIUS } from '../theme';
import { useApp } from '../state/AppContext';
import { ApiClient } from '../api/client';
import type { ServerOrderDetail } from '../types';

const REFRESH_MS = 15000;
const ACTIVE_STATUSES = ['pending', 'confirmed', 'preparing'];

/** How long a ticket has been open before its timer badge escalates. */
function ageBand(createdAt: string): 'fresh' | 'warm' | 'late' {
  const minutes = (Date.now() - new Date(createdAt).getTime()) / 60000;
  if (minutes >= 15) return 'late';
  if (minutes >= 8) return 'warm';
  return 'fresh';
}

function elapsed(createdAt: string): string {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 60000));
  return `${minutes}m`;
}

/**
 * Kitchen bump screen: every order still cooking, oldest first, with a Bump
 * button per ticket. Bumping marks the order 'ready' server-side, which drops
 * it off this screen on the next poll. Pulls from the same order list/detail
 * endpoints the Orders history screen uses — no dedicated KDS endpoint exists,
 * since ticket volume here is small enough that N+1 detail fetches are fine.
 */
export function KdsScreen() {
  const { settings, online } = useApp();
  const [tickets, setTickets] = useState<ServerOrderDetail[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bumping, setBumping] = useState<string | null>(null);
  const [, setTick] = useState(0);

  const client = useMemo(
    () => new ApiClient(settings.apiUrl, settings.apiKey),
    [settings.apiUrl, settings.apiKey],
  );

  const load = useCallback(async () => {
    if (!client.isConfigured) {
      setError('Configure API URL and key in Settings.');
      return;
    }
    if (!online) {
      setError('The kitchen screen requires a network connection.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const lists = await Promise.all(
        ACTIVE_STATUSES.map((status) =>
          client.getOrders({ status, limit: 50 }),
        ),
      );
      const summaries = lists.flatMap((r) => r.data);
      const details = await Promise.all(
        summaries.map((o) => client.getOrderById(o.id)),
      );
      details.sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      );
      setTickets(details);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load kitchen tickets.');
    } finally {
      setLoading(false);
    }
  }, [client, online]);

  useEffect(() => {
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  // Re-render every 30s so the elapsed-time badges keep ticking between polls.
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(timer);
  }, []);

  const bump = async (id: string) => {
    setBumping(id);
    try {
      await client.updateOrderStatus(id, 'ready');
      setTickets((prev) => prev.filter((t) => t.id !== id));
    } catch {
      // Leave the ticket in place — the next poll will reconcile either way.
    } finally {
      setBumping(null);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text variant="titleMedium" style={styles.title}>
          Kitchen — {tickets.length} open ticket{tickets.length === 1 ? '' : 's'}
        </Text>
        <Button
          mode="text"
          icon="refresh"
          compact
          onPress={load}
          loading={loading}
          textColor={antd.textSecondary}
        >
          Refresh
        </Button>
      </View>

      {error ? (
        <View style={styles.empty}>
          <MaterialCommunityIcons name="wifi-off" size={40} color={antd.textQuaternary} />
          <Text variant="bodyMedium" style={styles.emptyText}>{error}</Text>
        </View>
      ) : tickets.length === 0 ? (
        <View style={styles.empty}>
          <MaterialCommunityIcons name="chef-hat" size={48} color={antd.textQuaternary} />
          <Text variant="bodyMedium" style={styles.emptyText}>
            {loading ? 'Loading tickets…' : 'All caught up — no open tickets.'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={tickets}
          key={3}
          numColumns={3}
          keyExtractor={(t) => t.id}
          columnWrapperStyle={styles.row}
          contentContainerStyle={styles.grid}
          extraData={bumping}
          renderItem={({ item }) => (
            <TicketCard
              order={item}
              bumping={bumping === item.id}
              onBump={() => bump(item.id)}
            />
          )}
        />
      )}
    </View>
  );
}

function TicketCard({
  order,
  bumping,
  onBump,
}: {
  order: ServerOrderDetail;
  bumping: boolean;
  onBump: () => void;
}) {
  const band = ageBand(order.createdAt);
  const byCourse = new Map<number, ServerOrderDetail['items']>();
  const uncoursed: ServerOrderDetail['items'] = [];
  for (const item of order.items) {
    if (item.course) {
      byCourse.set(item.course, [...(byCourse.get(item.course) ?? []), item]);
    } else {
      uncoursed.push(item);
    }
  }
  const courses = [...byCourse.keys()].sort((a, b) => a - b);

  return (
    <View style={[styles.card, band === 'late' && styles.cardLate, band === 'warm' && styles.cardWarm]}>
      <View style={styles.cardHeader}>
        <Text variant="titleMedium" style={styles.ticketNo}>
          {order.ticketNumber ? `#${order.ticketNumber}` : order.id.slice(0, 6)}
        </Text>
        <View style={[styles.ageBadge, band === 'late' && styles.ageBadgeLate, band === 'warm' && styles.ageBadgeWarm]}>
          <MaterialCommunityIcons
            name="clock-outline"
            size={12}
            color={band === 'fresh' ? antd.textSecondary : '#fff'}
          />
          <Text style={[styles.ageText, band !== 'fresh' && styles.ageTextActive]}>
            {elapsed(order.createdAt)}
          </Text>
        </View>
      </View>
      <Text variant="labelMedium" style={styles.subhead} numberOfLines={1}>
        {order.tableName ? `Table ${order.tableName}` : (order.orderType ?? 'Order').replace('_', ' ')}
        {' · '}
        {order.customerName}
      </Text>

      <View style={styles.itemsWrap}>
        {courses.map((course) => (
          <View key={course} style={styles.courseGroup}>
            <Text variant="labelSmall" style={styles.courseLabel}>
              COURSE {course}
            </Text>
            {byCourse.get(course)!.map((item) => (
              <ItemRow key={item.id} item={item} />
            ))}
          </View>
        ))}
        {uncoursed.map((item) => (
          <ItemRow key={item.id} item={item} />
        ))}
      </View>

      <Button
        mode="contained"
        icon="check-bold"
        onPress={onBump}
        loading={bumping}
        disabled={bumping}
        style={styles.bumpBtn}
        contentStyle={styles.bumpBtnContent}
      >
        Bump
      </Button>
    </View>
  );
}

function ItemRow({ item }: { item: ServerOrderDetail['items'][number] }) {
  return (
    <View style={styles.itemRow}>
      <View style={styles.itemLine}>
        <Text variant="bodyMedium" style={styles.itemQty}>{item.quantity}×</Text>
        <Text variant="bodyMedium" style={styles.itemName} numberOfLines={2}>{item.name}</Text>
        {item.firedAt && (
          <MaterialCommunityIcons name="fire" size={14} color={antd.warning} />
        )}
      </View>
      {item.notes ? (
        <Text variant="bodySmall" style={styles.itemNotes} numberOfLines={2}>
          {item.notes}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: antd.bgLayout },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: antd.bgContainer,
    borderBottomWidth: 1,
    borderBottomColor: antd.split,
  },
  title: { color: antd.text, fontWeight: '600' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingTop: 60 },
  emptyText: { color: antd.textTertiary, textAlign: 'center', paddingHorizontal: 32 },
  grid: { padding: 12 },
  row: { gap: 12, marginBottom: 12 },
  card: {
    flex: 1,
    maxWidth: '33%',
    backgroundColor: antd.bgContainer,
    borderRadius: RADIUS,
    borderWidth: 1,
    borderColor: antd.split,
    padding: 12,
    gap: 8,
  },
  cardWarm: { borderColor: antd.warning },
  cardLate: { borderColor: antd.error },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  ticketNo: { color: antd.text, fontWeight: '800' },
  ageBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: RADIUS,
    backgroundColor: antd.bgLayout,
  },
  ageBadgeWarm: { backgroundColor: antd.warning },
  ageBadgeLate: { backgroundColor: antd.error },
  ageText: { fontSize: 11, fontWeight: '700', color: antd.textSecondary },
  ageTextActive: { color: '#fff' },
  subhead: { color: antd.textSecondary },
  itemsWrap: { gap: 6 },
  courseGroup: { gap: 3 },
  courseLabel: { color: antd.primary, letterSpacing: 0.5, fontWeight: '700' },
  itemRow: { gap: 1 },
  itemLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  itemQty: { color: antd.text, fontWeight: '700', minWidth: 22 },
  itemName: { color: antd.text, flex: 1 },
  itemNotes: { color: antd.textTertiary, fontStyle: 'italic', paddingLeft: 28 },
  bumpBtn: { borderRadius: RADIUS, marginTop: 4 },
  bumpBtnContent: { height: 40 },
});
