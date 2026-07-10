"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  App,
  Button,
  Card,
  Col,
  DatePicker,
  Empty,
  Row,
  Segmented,
  Skeleton,
  Table,
  Typography,
  theme,
} from "antd";
import { PrinterOutlined } from "@ant-design/icons";
import dayjs, { type Dayjs } from "dayjs";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "@/lib/api";
import { useLocation } from "@/contexts/LocationContext";
import PageHeader from "@/components/PageHeader";
import { EmptyState, ErrorState } from "@/components/PageStates";

const { Text } = Typography;

type ViewKey = "day" | "week" | "month" | "custom";
type Granularity = "day" | "week" | "month";

interface ReportBucket {
  period: string; // YYYY-MM-DD (bucket start)
  orders: number;
  sales: number; // cents
  refunds: number; // cents
  refundCount: number;
}

interface Report {
  granularity: Granularity;
  totals: {
    orders: number;
    sales: number;
    refunds: number;
    refundCount: number;
    netSales: number;
    avgOrder: number;
  };
  series: ReportBucket[];
  byType: { orderType: string | null; orders: number; sales: number }[];
  bySource: { source: string | null; orders: number; sales: number }[];
  topItems: { menuItemId: string; name: string; quantity: number; sales: number }[];
}

/**
 * One view control instead of range × granularity: each preset implies its
 * natural window and bucket size; Custom takes an explicit date range and
 * picks the bucket from the span.
 */
function resolveView(
  view: ViewKey,
  custom: [Dayjs, Dayjs] | null,
): { from: Dayjs; to: Dayjs; granularity: Granularity } {
  const today = dayjs().endOf("day");
  switch (view) {
    case "week":
      // Last 12 weeks, weekly buckets
      return { from: today.subtract(12, "week").startOf("day"), to: today, granularity: "week" };
    case "month":
      // Last 12 months, monthly buckets
      return { from: today.subtract(12, "month").startOf("day"), to: today, granularity: "month" };
    case "custom": {
      const [from, to] = custom ?? [today.subtract(29, "day"), today];
      const span = to.diff(from, "day");
      return {
        from: from.startOf("day"),
        to: to.endOf("day"),
        granularity: span <= 31 ? "day" : span <= 180 ? "week" : "month",
      };
    }
    case "day":
    default:
      // Last 30 days, daily buckets
      return { from: today.subtract(29, "day").startOf("day"), to: today, granularity: "day" };
  }
}

const TYPE_LABEL: Record<string, string> = {
  dine_in: "Dine-in",
  pickup: "Pickup",
  delivery: "Delivery",
};
const SOURCE_LABEL: Record<string, string> = {
  pos: "POS",
  ai_phone: "AI Phone",
  web: "Web",
};

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

// Validated categorical pair (dataviz palette): sales = blue, refunds = red.
const SERIES_COLORS = {
  light: { sales: "#2a78d6", refunds: "#e34948" },
  dark: { sales: "#3987e5", refunds: "#e66767" },
};

function periodLabel(period: string, granularity: Granularity): string {
  const d = dayjs(period);
  if (granularity === "month") return d.format("MMM YYYY");
  if (granularity === "week") return `wk of ${d.format("MMM D")}`;
  return d.format("MMM D");
}

export default function SalesReportsPage() {
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const { selectedLocationId } = useLocation();

  const [view, setView] = useState<ViewKey>("day");
  const [customRange, setCustomRange] = useState<[Dayjs, Dayjs] | null>(null);
  const [printing, setPrinting] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Ant's dark algorithm gives the container a dark background; use that to pick
  // the dark-validated series steps (a light/dark flag isn't exposed directly).
  const isDark = useMemo(() => {
    const m = /^#([0-9a-f]{6})$/i.exec(token.colorBgContainer);
    if (!m) return false;
    const v = parseInt(m[1], 16);
    const lum =
      0.299 * ((v >> 16) & 255) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255);
    return lum < 128;
  }, [token.colorBgContainer]);
  const colors = SERIES_COLORS[isDark ? "dark" : "light"];

  const load = useCallback(async () => {
    if (!selectedLocationId) return;
    setLoading(true);
    setError(null);
    try {
      const { from, to, granularity } = resolveView(view, customRange);
      const params = new URLSearchParams({
        locationId: selectedLocationId,
        dateFrom: from.toISOString(),
        dateTo: to.toISOString(),
        granularity,
      });
      const { data } = await api.get<Report>(`/orders/reports?${params}`);
      setReport(data);
    } catch {
      setError("Failed to load the report.");
    } finally {
      setLoading(false);
    }
  }, [selectedLocationId, view, customRange]);

  useEffect(() => {
    // Deferred a tick so the fetch's setState isn't synchronous in the effect.
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  const printReport = async () => {
    if (!selectedLocationId) return;
    setPrinting(true);
    try {
      const { from, to, granularity } = resolveView(view, customRange);
      await api.post("/orders/reports/print", {
        locationId: selectedLocationId,
        dateFrom: from.toISOString(),
        dateTo: to.toISOString(),
        granularity,
      });
      message.success("Report sent to the receipt printer.");
    } catch {
      message.error("Failed to queue the report for printing.");
    } finally {
      setPrinting(false);
    }
  };

  const chartData = useMemo(
    () =>
      (report?.series ?? []).map((b) => ({
        ...b,
        label: periodLabel(b.period, report?.granularity ?? "day"),
        salesDollars: b.sales / 100,
        refundsDollars: b.refunds / 100,
      })),
    [report],
  );
  const hasRefunds = (report?.totals.refunds ?? 0) > 0;

  if (!selectedLocationId) {
    return <EmptyState description="Select a location to view reports." />;
  }
  if (error) {
    return <ErrorState message={error} onRetry={load} />;
  }

  const tile = (label: string, value: string, sub?: string, accent?: string) => (
    <Card size="small" variant="outlined">
      <Text type="secondary" style={{ fontSize: 12, display: "block" }}>
        {label}
      </Text>
      <Text
        strong
        style={{
          fontSize: 24,
          fontVariantNumeric: "tabular-nums",
          color: accent,
        }}
      >
        {value}
      </Text>
      {sub && (
        <Text type="secondary" style={{ fontSize: 12, display: "block" }}>
          {sub}
        </Text>
      )}
    </Card>
  );

  return (
    <div>
      <PageHeader
        title="Sales Reports"
        subtitle="Orders, sales, and refunds over time"
        actions={
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <Segmented
              value={view}
              onChange={(v) => setView(v as ViewKey)}
              options={[
                { label: "Daily", value: "day" },
                { label: "Weekly", value: "week" },
                { label: "Monthly", value: "month" },
                { label: "Custom", value: "custom" },
              ]}
              aria-label="Report view"
            />
            {view === "custom" && (
              <DatePicker.RangePicker
                value={customRange}
                onChange={(dates) => {
                  if (dates?.[0] && dates?.[1]) {
                    setCustomRange([dates[0], dates[1]]);
                  } else {
                    setCustomRange(null);
                  }
                }}
                allowClear={false}
                disabledDate={(d) => d.isAfter(dayjs().endOf("day"))}
                aria-label="Custom date range"
              />
            )}
            <Button
              icon={<PrinterOutlined />}
              loading={printing}
              disabled={loading || !report || report.totals.orders === 0}
              onClick={printReport}
              aria-label="Print report to receipt printer"
            >
              Print
            </Button>
          </div>
        }
      />

      {loading || !report ? (
        <Skeleton active paragraph={{ rows: 10 }} />
      ) : (
        <>
          {/* Headline tiles */}
          <Row gutter={[12, 12]} style={{ marginBottom: token.margin }}>
            <Col xs={12} md={4}>{tile("Orders", String(report.totals.orders))}</Col>
            <Col xs={12} md={5}>{tile("Gross Sales", money(report.totals.sales))}</Col>
            <Col xs={12} md={5}>
              {tile(
                "Refunds",
                money(report.totals.refunds),
                report.totals.refundCount > 0
                  ? `${report.totals.refundCount} refund${report.totals.refundCount === 1 ? "" : "s"}`
                  : "none",
                report.totals.refunds > 0 ? colors.refunds : undefined,
              )}
            </Col>
            <Col xs={12} md={5}>{tile("Net Sales", money(report.totals.netSales))}</Col>
            <Col xs={24} md={5}>{tile("Avg Order", money(report.totals.avgOrder))}</Col>
          </Row>

          {/* Time series */}
          <Card
            size="small"
            title={`Sales by ${report.granularity}`}
            style={{ marginBottom: token.margin }}
          >
            {chartData.length === 0 ? (
              <Empty description="No orders in this range." />
            ) : (
              <div style={{ width: "100%", height: 320 }}>
                <ResponsiveContainer>
                  <BarChart data={chartData} barGap={2}>
                    <CartesianGrid
                      vertical={false}
                      stroke={token.colorBorderSecondary}
                    />
                    <XAxis
                      dataKey="label"
                      tick={{ fill: token.colorTextSecondary, fontSize: 12 }}
                      tickLine={false}
                      axisLine={{ stroke: token.colorBorderSecondary }}
                    />
                    <YAxis
                      tickFormatter={(v: number) => `$${v}`}
                      tick={{ fill: token.colorTextSecondary, fontSize: 12 }}
                      tickLine={false}
                      axisLine={false}
                      width={56}
                    />
                    <Tooltip
                      cursor={{ fill: token.colorFillTertiary }}
                      formatter={(value, name) => [
                        `$${Number(value ?? 0).toFixed(2)}`,
                        String(name ?? ""),
                      ]}
                      contentStyle={{
                        background: token.colorBgElevated,
                        border: `1px solid ${token.colorBorderSecondary}`,
                        borderRadius: token.borderRadius,
                        color: token.colorText,
                      }}
                    />
                    {hasRefunds && <Legend />}
                    <Bar
                      dataKey="salesDollars"
                      name="Sales"
                      fill={colors.sales}
                      radius={[4, 4, 0, 0]}
                      maxBarSize={40}
                    />
                    {hasRefunds && (
                      <Bar
                        dataKey="refundsDollars"
                        name="Refunds"
                        fill={colors.refunds}
                        radius={[4, 4, 0, 0]}
                        maxBarSize={40}
                      />
                    )}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>

          {/* Breakdowns */}
          <Row gutter={[12, 12]} style={{ marginBottom: token.margin }}>
            <Col xs={24} md={8}>
              <Card size="small" title="By Order Type">
                <Table
                  size="small"
                  pagination={false}
                  rowKey={(r) => r.orderType ?? "unknown"}
                  dataSource={report.byType}
                  aria-label="Sales by order type"
                  columns={[
                    {
                      title: "Type",
                      dataIndex: "orderType",
                      render: (v: string | null) =>
                        v ? (TYPE_LABEL[v] ?? v) : "Unknown",
                    },
                    { title: "Orders", dataIndex: "orders", align: "right" },
                    {
                      title: "Sales",
                      dataIndex: "sales",
                      align: "right",
                      render: (v: number) => money(v),
                    },
                  ]}
                />
              </Card>
            </Col>
            <Col xs={24} md={8}>
              <Card size="small" title="By Source">
                <Table
                  size="small"
                  pagination={false}
                  rowKey={(r) => r.source ?? "unknown"}
                  dataSource={report.bySource}
                  aria-label="Sales by source"
                  columns={[
                    {
                      title: "Source",
                      dataIndex: "source",
                      render: (v: string | null) =>
                        v ? (SOURCE_LABEL[v] ?? v) : "Unknown",
                    },
                    { title: "Orders", dataIndex: "orders", align: "right" },
                    {
                      title: "Sales",
                      dataIndex: "sales",
                      align: "right",
                      render: (v: number) => money(v),
                    },
                  ]}
                />
              </Card>
            </Col>
            <Col xs={24} md={8}>
              <Card size="small" title="Top Items">
                <Table
                  size="small"
                  pagination={false}
                  rowKey="menuItemId"
                  dataSource={report.topItems}
                  aria-label="Top selling items"
                  columns={[
                    { title: "Item", dataIndex: "name", ellipsis: true },
                    { title: "Qty", dataIndex: "quantity", align: "right" },
                    {
                      title: "Sales",
                      dataIndex: "sales",
                      align: "right",
                      render: (v: number) => money(v),
                    },
                  ]}
                />
              </Card>
            </Col>
          </Row>

          {/* Accessible table view of the chart series */}
          <Card size="small" title="Period Detail">
            <Table
              size="small"
              pagination={false}
              rowKey="period"
              dataSource={report.series}
              aria-label="Report data by period"
              columns={[
                {
                  title: "Period",
                  dataIndex: "period",
                  render: (v: string) => periodLabel(v, report.granularity),
                },
                { title: "Orders", dataIndex: "orders", align: "right" },
                {
                  title: "Sales",
                  dataIndex: "sales",
                  align: "right",
                  render: (v: number) => money(v),
                },
                {
                  title: "Refunds",
                  dataIndex: "refunds",
                  align: "right",
                  render: (v: number, r) =>
                    v > 0 ? `${money(v)} (${r.refundCount})` : "—",
                },
                {
                  title: "Net",
                  align: "right",
                  render: (_: unknown, r) => money(r.sales - r.refunds),
                },
              ]}
            />
          </Card>
        </>
      )}
    </div>
  );
}
