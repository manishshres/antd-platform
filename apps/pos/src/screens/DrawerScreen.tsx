import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Button, Divider, Text } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { antd, RADIUS } from '../theme';
import { useApp } from '../state/AppContext';
import * as drawerRepo from '../db/drawerRepo';
import { formatMoney, parseMoney } from '../utils/money';
import type { DrawerSession } from '../types';

type ActiveTab = 'drawer' | 'today' | 'sales';

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function startOfTodayIso(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

const PAYMENT_LABELS: Record<string, string> = { cash: 'Cash', card: 'Card' };

export function DrawerScreen() {
  const { dataVersion } = useApp();
  const [activeTab, setActiveTab] = useState<ActiveTab>('drawer');
  const [session, setSession] = useState<DrawerSession | null>(null);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    setSession(drawerRepo.getOpenSession());
  }, [dataVersion, refresh]);

  // Sales window: the open session if there is one, otherwise today.
  const sinceIso = session?.openedAt ?? startOfTodayIso();
  const sales = useMemo(
    () => drawerRepo.salesSince(sinceIso),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sinceIso, dataVersion, refresh, activeTab],
  );
  const paidOrders = useMemo(
    () => drawerRepo.paidOrdersSince(sinceIso),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sinceIso, dataVersion, refresh, activeTab],
  );

  const bump = useCallback(() => setRefresh((n) => n + 1), []);

  return (
    <View style={styles.root}>
      {/* Tab bar */}
      <View style={styles.tabBar}>
        {(
          [
            { key: 'drawer', label: 'Cash Drawer' },
            { key: 'today', label: "Today's Sale" },
            { key: 'sales', label: 'Sale History' },
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
          </TouchableOpacity>
        ))}
      </View>

      {activeTab === 'drawer' && (
        <CashDrawerTab session={session} sales={sales} onChanged={bump} />
      )}
      {activeTab === 'today' && (
        <TodaysSaleTab session={session} sales={sales} orders={paidOrders} />
      )}
      {activeTab === 'sales' && <SaleHistoryTab orders={paidOrders} />}
    </View>
  );
}

// ── Cash Drawer tab ───────────────────────────────────────────────────────────

function CashDrawerTab({
  session,
  sales,
  onChanged,
}: {
  session: DrawerSession | null;
  sales: { cashSales: number; otherSales: number };
  onChanged: () => void;
}) {
  if (!session) return <OpenDrawerCard onChanged={onChanged} />;
  return <DrawerSummaryCard session={session} sales={sales} onChanged={onChanged} />;
}

function OpenDrawerCard({ onChanged }: { onChanged: () => void }) {
  const [amount, setAmount] = useState('');
  const lastClosed = useMemo(() => drawerRepo.listClosedSessions(1)[0] ?? null, []);

  const openDrawer = () => {
    drawerRepo.openSession(parseMoney(amount));
    onChanged();
  };

  return (
    <ScrollView contentContainerStyle={styles.centerWrap}>
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <MaterialCommunityIcons name="cash-register" size={20} color={antd.primary} />
          <Text style={styles.cardTitle}>Open Drawer</Text>
        </View>
        <Divider />
        <View style={styles.cardBody}>
          <Text style={styles.fieldLabel}>Opening Drawer Amount</Text>
          <TextInput
            style={styles.moneyInput}
            value={amount}
            onChangeText={setAmount}
            placeholder="$0.00"
            placeholderTextColor={antd.textQuaternary}
            keyboardType="decimal-pad"
          />
          <Text style={styles.hint}>
            Count the cash float in the drawer before taking the first order.
          </Text>
          {lastClosed && (
            <View style={styles.lastClosed}>
              <Text style={styles.hint}>
                Last drawer closed {fmtDateTime(lastClosed.closedAt ?? lastClosed.openedAt)} —
                counted {formatMoney(lastClosed.countedAmount)}
                {lastClosed.difference
                  ? ` (${lastClosed.difference > 0 ? '+' : ''}${formatMoney(lastClosed.difference)} difference)`
                  : ' (no difference)'}
              </Text>
            </View>
          )}
          <Button
            mode="contained"
            onPress={openDrawer}
            style={styles.primaryBtn}
            contentStyle={styles.btnContent}
          >
            Open Drawer
          </Button>
        </View>
      </View>
    </ScrollView>
  );
}

function DrawerSummaryCard({
  session,
  sales,
  onChanged,
}: {
  session: DrawerSession;
  sales: { cashSales: number; otherSales: number };
  onChanged: () => void;
}) {
  const [counted, setCounted] = useState('');
  const [remarks, setRemarks] = useState('');

  const expected = session.openingAmount + sales.cashSales;
  const countedCents = counted.trim() ? parseMoney(counted) : null;
  const difference = countedCents === null ? null : countedCents - expected;

  const closeDrawer = () => {
    if (countedCents === null) {
      Alert.alert('Count the drawer', 'Enter the counted drawer amount before closing.');
      return;
    }
    Alert.alert(
      'Close Drawer',
      `Expected ${formatMoney(expected)}, counted ${formatMoney(countedCents)}. Close this drawer session?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Close Drawer',
          style: 'destructive',
          onPress: () => {
            drawerRepo.closeSession(session.id, countedCents, remarks.trim() || null);
            onChanged();
          },
        },
      ],
    );
  };

  return (
    <ScrollView contentContainerStyle={styles.centerWrap}>
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <MaterialCommunityIcons name="cash-register" size={20} color={antd.primary} />
          <Text style={styles.cardTitle}>Drawer Amount Summary</Text>
          <View style={styles.openPill}>
            <Text style={styles.openPillText}>Open since {fmtTime(session.openedAt)}</Text>
          </View>
        </View>
        <Divider />
        <View style={styles.cardBody}>
          <SummaryRow label="Opening Drawer Amount" value={formatMoney(session.openingAmount)} />
          <SummaryRow label="Cash Payment Sale" value={formatMoney(sales.cashSales)} />
          <SummaryRow label="Other Payments Sale" value={formatMoney(sales.otherSales)} />
          <Divider style={styles.rowDivider} />
          <SummaryRow label="Expected Drawer Amount" value={formatMoney(expected)} bold />

          <Text style={[styles.fieldLabel, styles.fieldGap]}>Counted Drawer Amount</Text>
          <TextInput
            style={styles.moneyInput}
            value={counted}
            onChangeText={setCounted}
            placeholder="$0.00"
            placeholderTextColor={antd.textQuaternary}
            keyboardType="decimal-pad"
          />

          <SummaryRow
            label="Difference"
            value={difference === null ? '—' : formatMoney(difference)}
            color={
              difference === null || difference === 0
                ? undefined
                : difference > 0
                  ? antd.success
                  : antd.error
            }
            bold
          />

          <Text style={[styles.fieldLabel, styles.fieldGap]}>Remarks</Text>
          <TextInput
            style={[styles.moneyInput, styles.remarksInput]}
            value={remarks}
            onChangeText={setRemarks}
            placeholder="Optional note about this drawer session"
            placeholderTextColor={antd.textQuaternary}
            multiline
          />

          <Button
            mode="contained"
            onPress={closeDrawer}
            buttonColor={antd.success}
            style={styles.primaryBtn}
            contentStyle={styles.btnContent}
          >
            Close Drawer
          </Button>
        </View>
      </View>
    </ScrollView>
  );
}

function SummaryRow({
  label,
  value,
  bold,
  color,
}: {
  label: string;
  value: string;
  bold?: boolean;
  color?: string;
}) {
  return (
    <View style={styles.summaryRow}>
      <Text style={[styles.summaryLabel, bold && styles.summaryBold]}>{label}</Text>
      <Text style={[styles.summaryValue, bold && styles.summaryBold, color ? { color } : null]}>
        {value}
      </Text>
    </View>
  );
}

// ── Today's Sale tab ──────────────────────────────────────────────────────────

function TodaysSaleTab({
  session,
  sales,
  orders,
}: {
  session: DrawerSession | null;
  sales: { cashSales: number; otherSales: number };
  orders: drawerRepo.PaidOrderSummary[];
}) {
  return (
    <View style={styles.tabBody}>
      <View style={styles.statRow}>
        <StatTile
          label="Opening Drawer Amount"
          value={formatMoney(session?.openingAmount ?? 0)}
          icon="cash-lock-open"
          color={antd.primary}
          bg={antd.primaryBg}
        />
        <StatTile
          label="Cash Payment Sale"
          value={formatMoney(sales.cashSales)}
          icon="cash"
          color={antd.success}
          bg={antd.successBg}
        />
        <StatTile
          label="Other Payment Sale"
          value={formatMoney(sales.otherSales)}
          icon="credit-card-outline"
          color={antd.warning}
          bg={antd.warningBg}
        />
      </View>
      <Text style={styles.sectionTitle}>Sale History</Text>
      <SalesTable orders={orders} />
    </View>
  );
}

function StatTile({
  label,
  value,
  icon,
  color,
  bg,
}: {
  label: string;
  value: string;
  icon: string;
  color: string;
  bg: string;
}) {
  return (
    <View style={styles.statTile}>
      <View style={[styles.statIcon, { backgroundColor: bg }]}>
        <MaterialCommunityIcons name={icon as never} size={22} color={color} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.statLabel} numberOfLines={1}>{label}</Text>
        <Text style={styles.statValue}>{value}</Text>
      </View>
    </View>
  );
}

// ── Sale History tab ──────────────────────────────────────────────────────────

function SaleHistoryTab({ orders }: { orders: drawerRepo.PaidOrderSummary[] }) {
  return (
    <View style={styles.tabBody}>
      <SalesTable orders={orders} />
    </View>
  );
}

function SalesTable({ orders }: { orders: drawerRepo.PaidOrderSummary[] }) {
  return (
    <View style={styles.table}>
      <View style={styles.tableHead}>
        <Text style={[styles.th, { flex: 2 }]}>Order Id</Text>
        <Text style={[styles.th, { flex: 2 }]}>Customer</Text>
        <Text style={[styles.th, { flex: 1.4 }]}>Time</Text>
        <Text style={[styles.th, { flex: 1.4, textAlign: 'right' }]}>Order Total</Text>
        <Text style={[styles.th, { flex: 1.2, textAlign: 'right' }]}>Payment</Text>
      </View>
      <FlatList
        data={orders}
        keyExtractor={(o) => o.id}
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <MaterialCommunityIcons name="receipt-text-outline" size={36} color={antd.textQuaternary} />
            <Text style={styles.emptyText}>No paid orders in this drawer session yet</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.tr}>
            <Text style={[styles.td, { flex: 2 }]} numberOfLines={1}>
              {item.ticketNumber != null ? `#${item.ticketNumber}` : item.id.slice(0, 8)}
            </Text>
            <Text style={[styles.td, { flex: 2 }]} numberOfLines={1}>{item.customerName}</Text>
            <Text style={[styles.td, { flex: 1.4 }]}>{fmtTime(item.createdAt)}</Text>
            <Text style={[styles.td, styles.tdMoney, { flex: 1.4 }]}>
              {formatMoney(item.totalAmount)}
            </Text>
            <Text style={[styles.td, { flex: 1.2, textAlign: 'right' }]}>
              {item.paymentMethod ? (PAYMENT_LABELS[item.paymentMethod] ?? item.paymentMethod) : '—'}
            </Text>
          </View>
        )}
      />
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: antd.bgLayout },

  // Tab bar (matches Orders screen)
  tabBar: {
    flexDirection: 'row',
    backgroundColor: antd.bgContainer,
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
  },
  tabActive: { borderBottomColor: antd.primary },
  tabText: { fontSize: 13, fontWeight: '500', color: antd.textSecondary },
  tabTextActive: { color: antd.primary, fontWeight: '600' },

  tabBody: { flex: 1, padding: 16, gap: 12 },
  centerWrap: { flexGrow: 1, alignItems: 'center', paddingVertical: 24 },

  // Card
  card: {
    width: 520,
    maxWidth: '94%',
    backgroundColor: antd.bgContainer,
    borderRadius: RADIUS,
    borderWidth: 1,
    borderColor: antd.split,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  cardTitle: { fontSize: 15, fontWeight: '600', color: antd.text, flex: 1 },
  openPill: {
    backgroundColor: antd.successBg,
    borderWidth: 1,
    borderColor: antd.successBorder,
    borderRadius: RADIUS,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  openPillText: { fontSize: 11, fontWeight: '600', color: antd.success },
  cardBody: { padding: 16 },

  fieldLabel: { fontSize: 12, fontWeight: '500', color: antd.textSecondary, marginBottom: 6 },
  fieldGap: { marginTop: 14 },
  moneyInput: {
    borderWidth: 1,
    borderColor: antd.border,
    borderRadius: RADIUS,
    backgroundColor: antd.bgContainer,
    paddingHorizontal: 12,
    height: 42,
    fontSize: 15,
    color: antd.text,
  },
  remarksInput: { height: 70, paddingTop: 10, textAlignVertical: 'top' },
  hint: { fontSize: 12, color: antd.textTertiary, marginTop: 8 },
  lastClosed: {
    marginTop: 10,
    backgroundColor: antd.bgLayout,
    borderRadius: RADIUS,
    padding: 10,
  },
  primaryBtn: { marginTop: 18, borderRadius: RADIUS },
  btnContent: { height: 46 },

  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  summaryLabel: { fontSize: 13, color: antd.textSecondary },
  summaryValue: { fontSize: 13, color: antd.text, fontVariant: ['tabular-nums'] },
  summaryBold: { fontWeight: '700', color: antd.text, fontSize: 14 },
  rowDivider: { marginVertical: 4 },

  // Stat tiles
  statRow: { flexDirection: 'row', gap: 12 },
  statTile: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: antd.bgContainer,
    borderRadius: RADIUS,
    borderWidth: 1,
    borderColor: antd.split,
    padding: 14,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  statIcon: {
    width: 42,
    height: 42,
    borderRadius: RADIUS,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statLabel: { fontSize: 12, color: antd.textTertiary },
  statValue: { fontSize: 18, fontWeight: '700', color: antd.text, marginTop: 2 },

  sectionTitle: { fontSize: 14, fontWeight: '600', color: antd.text, marginTop: 4 },

  // Table
  table: {
    flex: 1,
    backgroundColor: antd.bgContainer,
    borderRadius: RADIUS,
    borderWidth: 1,
    borderColor: antd.split,
    overflow: 'hidden',
  },
  tableHead: {
    flexDirection: 'row',
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: antd.bgLayout,
    borderBottomWidth: 1,
    borderBottomColor: antd.split,
  },
  th: { fontSize: 12, fontWeight: '600', color: antd.textSecondary },
  tr: {
    flexDirection: 'row',
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: antd.split,
    alignItems: 'center',
  },
  td: { fontSize: 13, color: antd.text },
  tdMoney: { textAlign: 'right', fontVariant: ['tabular-nums'], fontWeight: '600' },
  emptyWrap: { alignItems: 'center', paddingVertical: 48, gap: 8 },
  emptyText: { fontSize: 13, color: antd.textTertiary },
});
