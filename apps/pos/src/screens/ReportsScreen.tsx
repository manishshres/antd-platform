import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import {
  ActivityIndicator,
  Button,
  Divider,
  SegmentedButtons,
  Surface,
  Text,
  TouchableRipple,
} from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { antd, RADIUS } from '../theme';
import { useApp } from '../state/AppContext';
import { ApiClient, ApiNetworkError, ApiRequestError } from '../api/client';
import { formatMoney } from '../utils/money';

type Granularity = 'day' | 'week' | 'month';
type DatePreset = 'today' | 'yesterday' | 'week' | 'month' | 'custom';
type TabKey = 'summary' | 'sales' | 'items' | 'sources';

interface Summary {
  openCount: number;
  openTotal: number;
  salesTotal: number;
  salesCount: number;
  refundTotal: number;
  refundCount: number;
}

interface Report {
  granularity: string;
  dateFrom: string;
  dateTo: string;
  totals: {
    orders: number;
    sales: number;
    refunds: number;
    refundCount: number;
    netSales: number;
    avgOrder: number;
  };
  series: { period: string; orders: number; sales: number; refunds: number; refundCount: number }[];
  byType: { orderType: string; orders: number; sales: number }[];
  bySource: { source: string | null; orders: number; sales: number }[];
  topItems: { menuItemId: string; name: string; quantity: number; sales: number }[];
}

function localIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function today(): { from: string; to: string } {
  const s = localIsoDate(new Date());
  return { from: s, to: s };
}
function yesterday(): { from: string; to: string } {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const s = localIsoDate(d);
  return { from: s, to: s };
}
function thisWeek(): { from: string; to: string } {
  const d = new Date();
  const mon = new Date(d);
  mon.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return { from: localIsoDate(mon), to: localIsoDate(new Date()) };
}
function thisMonth(): { from: string; to: string } {
  const d = new Date();
  const first = new Date(d.getFullYear(), d.getMonth(), 1);
  return { from: localIsoDate(first), to: localIsoDate(d) };
}

function presetRange(preset: DatePreset): { from: string; to: string } | null {
  if (preset === 'today') return today();
  if (preset === 'yesterday') return yesterday();
  if (preset === 'week') return thisWeek();
  if (preset === 'month') return thisMonth();
  return null;
}

const DATE_PRESETS: { label: string; value: DatePreset }[] = [
  { label: 'Today', value: 'today' },
  { label: 'Yesterday', value: 'yesterday' },
  { label: 'This Week', value: 'week' },
  { label: 'This Month', value: 'month' },
];

const ORDER_TYPE_LABELS: Record<string, string> = {
  dine_in: 'Dine In',
  pickup: 'Pickup',
  delivery: 'Delivery',
};

const SOURCE_LABELS: Record<string, string> = {
  pos: 'POS',
  phone_ai: 'Phone AI',
  online: 'Online',
  doordash: 'DoorDash',
  ubereats: 'Uber Eats',
  grubhub: 'Grubhub',
};

function SummaryCard({
  icon,
  label,
  value,
  sub,
  color,
}: {
  icon: string;
  label: string;
  value: string;
  sub?: string;
  color?: string;
}) {
  return (
    <Surface style={styles.card} elevation={1}>
      <View style={styles.cardIcon}>
        <MaterialCommunityIcons
          name={icon as never}
          size={22}
          color={color ?? antd.primary}
        />
      </View>
      <Text variant="labelSmall" style={styles.cardLabel}>
        {label}
      </Text>
      <Text variant="titleMedium" style={[styles.cardValue, color ? { color } : null]}>
        {value}
      </Text>
      {sub ? (
        <Text variant="labelSmall" style={styles.cardSub}>
          {sub}
        </Text>
      ) : null}
    </Surface>
  );
}

function TableHeader({ cols }: { cols: string[] }) {
  return (
    <View style={[styles.row, styles.tableHeader]}>
      {cols.map((c, i) => (
        <Text key={i} variant="labelSmall" style={[styles.cell, i > 0 && styles.cellRight, styles.headerCell]}>
          {c}
        </Text>
      ))}
    </View>
  );
}

export function ReportsScreen() {
  const { settings, online } = useApp();

  const [preset, setPreset] = useState<DatePreset>('today');
  const [dateFrom, setDateFrom] = useState(today().from);
  const [dateTo, setDateTo] = useState(today().to);
  const [granularity, setGranularity] = useState<Granularity>('day');
  const [tab, setTab] = useState<TabKey>('summary');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [report, setReport] = useState<Report | null>(null);

  const locationId = settings.locationId;

  const load = useCallback(async () => {
    if (!settings.apiUrl || !settings.apiKey || !locationId) {
      setError('Configure API URL, API key, and location in Settings.');
      return;
    }
    if (!online) {
      setError('Reports require a network connection.');
      return;
    }
    setLoading(true);
    setError(null);
    const client = new ApiClient(settings.apiUrl, settings.apiKey);
    try {
      const [sum, rep] = await Promise.all([
        client.getOrderSummary({ locationId, dateFrom, dateTo }),
        client.getOrderReport({ locationId, dateFrom, dateTo, granularity }),
      ]);
      setSummary(sum);
      setReport(rep);
    } catch (err) {
      if (err instanceof ApiNetworkError) {
        setError('Network error — check your connection and try again.');
      } else if (err instanceof ApiRequestError) {
        setError(`Server error ${err.status}: ${err.message}`);
      } else {
        setError('Unexpected error loading reports.');
      }
    } finally {
      setLoading(false);
    }
  }, [settings, locationId, online, dateFrom, dateTo, granularity]);

  useEffect(() => {
    load();
  }, [load]);

  const handlePreset = (p: DatePreset) => {
    setPreset(p);
    const range = presetRange(p);
    if (range) {
      setDateFrom(range.from);
      setDateTo(range.to);
    }
  };

  const renderSummaryTab = () => {
    if (!summary || !report) return null;
    return (
      <View style={styles.tabContent}>
        <View style={styles.cards}>
          <SummaryCard
            icon="currency-usd"
            label="Net Sales"
            value={formatMoney(report.totals.netSales)}
            sub={`${report.totals.orders} paid orders`}
            color={antd.success}
          />
          <SummaryCard
            icon="receipt"
            label="Gross Sales"
            value={formatMoney(report.totals.sales)}
            sub={`avg ${formatMoney(report.totals.avgOrder)}/order`}
          />
          <SummaryCard
            icon="clock-outline"
            label="Open Orders"
            value={String(summary.openCount)}
            sub={formatMoney(summary.openTotal)}
            color={antd.warning}
          />
          <SummaryCard
            icon="undo-variant"
            label="Refunds / Voids"
            value={formatMoney(report.totals.refunds)}
            sub={`${report.totals.refundCount} orders`}
            color={antd.error}
          />
        </View>

        <Text variant="titleSmall" style={styles.sectionTitle}>
          Order Type Breakdown
        </Text>
        <Surface style={styles.table} elevation={0}>
          <TableHeader cols={['Order Type', 'Orders', 'Sales']} />
          {report.byType.map((bt) => (
            <View key={bt.orderType} style={[styles.row, styles.tableRow]}>
              <Text variant="bodySmall" style={styles.cell}>
                {ORDER_TYPE_LABELS[bt.orderType] ?? bt.orderType}
              </Text>
              <Text variant="bodySmall" style={[styles.cell, styles.cellRight]}>
                {bt.orders}
              </Text>
              <Text variant="bodySmall" style={[styles.cell, styles.cellRight]}>
                {formatMoney(bt.sales)}
              </Text>
            </View>
          ))}
          {report.byType.length === 0 && (
            <Text variant="bodySmall" style={styles.emptyRow}>
              No data for this period.
            </Text>
          )}
        </Surface>
      </View>
    );
  };

  const renderSalesTab = () => {
    if (!report) return null;
    return (
      <View style={styles.tabContent}>
        <View style={styles.cards}>
          <SummaryCard
            icon="trending-up"
            label="Total Sales"
            value={formatMoney(report.totals.sales)}
            color={antd.success}
          />
          <SummaryCard
            icon="trending-down"
            label="Total Refunds"
            value={formatMoney(report.totals.refunds)}
            color={antd.error}
          />
          <SummaryCard
            icon="cash"
            label="Net Sales"
            value={formatMoney(report.totals.netSales)}
          />
          <SummaryCard
            icon="calculator"
            label="Avg. Order"
            value={formatMoney(report.totals.avgOrder)}
          />
        </View>

        <Text variant="titleSmall" style={styles.sectionTitle}>
          Sales by Period ({report.granularity})
        </Text>
        <Surface style={styles.table} elevation={0}>
          <TableHeader cols={['Period', 'Orders', 'Sales', 'Refunds']} />
          {report.series.map((s) => (
            <View key={s.period} style={[styles.row, styles.tableRow]}>
              <Text variant="bodySmall" style={styles.cell}>
                {s.period}
              </Text>
              <Text variant="bodySmall" style={[styles.cell, styles.cellRight]}>
                {s.orders}
              </Text>
              <Text variant="bodySmall" style={[styles.cell, styles.cellRight]}>
                {formatMoney(s.sales)}
              </Text>
              <Text variant="bodySmall" style={[styles.cell, styles.cellRight, { color: s.refunds > 0 ? antd.error : antd.textTertiary }]}>
                {s.refunds > 0 ? `-${formatMoney(s.refunds)}` : '—'}
              </Text>
            </View>
          ))}
          {report.series.length === 0 && (
            <Text variant="bodySmall" style={styles.emptyRow}>
              No data for this period.
            </Text>
          )}
        </Surface>
      </View>
    );
  };

  const renderItemsTab = () => {
    if (!report) return null;
    return (
      <View style={styles.tabContent}>
        <Text variant="titleSmall" style={styles.sectionTitle}>
          Top-Selling Items
        </Text>
        <Surface style={styles.table} elevation={0}>
          <TableHeader cols={['Item', 'Qty Sold', 'Sales']} />
          {report.topItems.map((item, i) => (
            <View key={item.menuItemId} style={[styles.row, styles.tableRow]}>
              <View style={styles.rankCell}>
                <Text variant="labelSmall" style={styles.rank}>
                  #{i + 1}
                </Text>
                <Text variant="bodySmall" style={[styles.cell, { flex: 1 }]} numberOfLines={1}>
                  {item.name}
                </Text>
              </View>
              <Text variant="bodySmall" style={[styles.cell, styles.cellRight]}>
                {item.quantity}
              </Text>
              <Text variant="bodySmall" style={[styles.cell, styles.cellRight]}>
                {formatMoney(item.sales)}
              </Text>
            </View>
          ))}
          {report.topItems.length === 0 && (
            <Text variant="bodySmall" style={styles.emptyRow}>
              No data for this period.
            </Text>
          )}
        </Surface>
      </View>
    );
  };

  const renderSourcesTab = () => {
    if (!report) return null;
    return (
      <View style={styles.tabContent}>
        <Text variant="titleSmall" style={styles.sectionTitle}>
          Order Source Breakdown
        </Text>
        <Surface style={styles.table} elevation={0}>
          <TableHeader cols={['Source', 'Orders', 'Sales']} />
          {report.bySource.map((s) => (
            <View key={s.source ?? 'unknown'} style={[styles.row, styles.tableRow]}>
              <Text variant="bodySmall" style={styles.cell}>
                {s.source ? (SOURCE_LABELS[s.source] ?? s.source) : 'Unknown'}
              </Text>
              <Text variant="bodySmall" style={[styles.cell, styles.cellRight]}>
                {s.orders}
              </Text>
              <Text variant="bodySmall" style={[styles.cell, styles.cellRight]}>
                {formatMoney(s.sales)}
              </Text>
            </View>
          ))}
          {report.bySource.length === 0 && (
            <Text variant="bodySmall" style={styles.emptyRow}>
              No data for this period.
            </Text>
          )}
        </Surface>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {/* ── Toolbar ── */}
      <View style={styles.toolbar}>
        <View style={styles.presets}>
          {DATE_PRESETS.map((p) => (
            <TouchableRipple
              key={p.value}
              onPress={() => handlePreset(p.value)}
              style={[styles.presetTab, preset === p.value && styles.presetTabActive]}
              borderless
            >
              <Text style={[styles.presetText, preset === p.value && styles.presetTextActive]}>
                {p.label}
              </Text>
            </TouchableRipple>
          ))}
        </View>
        <View style={styles.toolbarRight}>
          <SegmentedButtons
            value={granularity}
            onValueChange={(v) => setGranularity(v as Granularity)}
            buttons={[
              { value: 'day', label: 'Day' },
              { value: 'week', label: 'Week' },
              { value: 'month', label: 'Month' },
            ]}
            style={styles.granularityPicker}
          />
          <Button
            mode="contained"
            icon="refresh"
            onPress={load}
            disabled={loading}
            style={{ borderRadius: RADIUS }}
            compact
          >
            Refresh
          </Button>
        </View>
      </View>

      <View style={styles.dateRange}>
        <Text variant="labelSmall" style={styles.dateRangeText}>
          {dateFrom === dateTo ? dateFrom : `${dateFrom} → ${dateTo}`}
        </Text>
      </View>

      {/* ── Tab bar ── */}
      <View style={styles.tabs}>
        {(
          [
            { key: 'summary', label: 'Summary', icon: 'view-dashboard-outline' },
            { key: 'sales', label: 'Sales by Date', icon: 'chart-line' },
            { key: 'items', label: 'Top Items', icon: 'food' },
            { key: 'sources', label: 'Order Sources', icon: 'store-outline' },
          ] as { key: TabKey; label: string; icon: string }[]
        ).map((t) => (
          <TouchableRipple
            key={t.key}
            onPress={() => setTab(t.key)}
            style={[styles.tabBtn, tab === t.key && styles.tabBtnActive]}
            borderless
          >
            <View style={styles.tabBtnInner}>
              <MaterialCommunityIcons
                name={t.icon as never}
                size={16}
                color={tab === t.key ? antd.primary : antd.textTertiary}
              />
              <Text
                style={[
                  styles.tabBtnText,
                  tab === t.key && styles.tabBtnTextActive,
                ]}
              >
                {t.label}
              </Text>
            </View>
          </TouchableRipple>
        ))}
      </View>
      <Divider />

      {/* ── Content ── */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={antd.primary} />
          <Text variant="bodySmall" style={{ color: antd.textTertiary, marginTop: 10 }}>
            Loading report…
          </Text>
        </View>
      ) : error ? (
        <View style={styles.center}>
          <MaterialCommunityIcons name="alert-circle-outline" size={40} color={antd.error} />
          <Text variant="bodyMedium" style={{ color: antd.error, marginTop: 10 }}>
            {error}
          </Text>
          <Button mode="outlined" onPress={load} style={{ marginTop: 16, borderRadius: RADIUS }}>
            Try Again
          </Button>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {tab === 'summary' && renderSummaryTab()}
          {tab === 'sales' && renderSalesTab()}
          {tab === 'items' && renderItemsTab()}
          {tab === 'sources' && renderSourcesTab()}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: antd.bgLayout },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    backgroundColor: antd.bgContainer,
    borderBottomWidth: 1,
    borderBottomColor: antd.split,
    gap: 12,
  },
  presets: { flexDirection: 'row', gap: 6 },
  presetTab: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: RADIUS,
    borderWidth: 1,
    borderColor: antd.border,
    backgroundColor: antd.bgContainer,
  },
  presetTabActive: { backgroundColor: antd.primary, borderColor: antd.primary },
  presetText: { color: antd.textSecondary, fontSize: 13, fontWeight: '500' },
  presetTextActive: { color: '#fff' },
  toolbarRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  granularityPicker: { height: 36 },

  dateRange: {
    paddingHorizontal: 16,
    paddingVertical: 4,
    backgroundColor: antd.bgContainer,
  },
  dateRangeText: { color: antd.textTertiary },

  tabs: {
    flexDirection: 'row',
    backgroundColor: antd.bgContainer,
    paddingHorizontal: 8,
    paddingTop: 6,
  },
  tabBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: RADIUS,
    marginRight: 4,
  },
  tabBtnActive: { backgroundColor: antd.primaryBg },
  tabBtnInner: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tabBtnText: { color: antd.textTertiary, fontSize: 13, fontWeight: '500' },
  tabBtnTextActive: { color: antd.primary },

  scrollContent: { padding: 16, paddingBottom: 40 },
  tabContent: { gap: 16 },

  cards: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  card: {
    flex: 1,
    minWidth: 160,
    padding: 14,
    borderRadius: RADIUS,
    backgroundColor: antd.bgContainer,
    gap: 4,
  },
  cardIcon: { marginBottom: 4 },
  cardLabel: { color: antd.textSecondary },
  cardValue: { color: antd.text, fontWeight: '700' },
  cardSub: { color: antd.textTertiary },

  sectionTitle: {
    color: antd.text,
    fontWeight: '600',
    marginTop: 4,
  },

  table: {
    borderRadius: RADIUS,
    backgroundColor: antd.bgContainer,
    borderWidth: 1,
    borderColor: antd.split,
    overflow: 'hidden',
  },
  tableHeader: {
    backgroundColor: antd.bgLayout,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  tableRow: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderTopWidth: 1,
    borderTopColor: antd.split,
  },
  row: { flexDirection: 'row', alignItems: 'center' },
  cell: { flex: 1, color: antd.text, fontSize: 13 },
  cellRight: { textAlign: 'right', flex: 0, minWidth: 80 },
  headerCell: { color: antd.textSecondary, fontWeight: '600', fontSize: 12 },
  emptyRow: { color: antd.textTertiary, padding: 16, textAlign: 'center' },

  rankCell: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  rank: {
    color: antd.primary,
    fontWeight: '700',
    minWidth: 24,
  },

  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
    gap: 8,
  },
});
