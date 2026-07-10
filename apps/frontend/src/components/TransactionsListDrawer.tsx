"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  App,
  Badge,
  Button,
  DatePicker,
  Drawer,
  Empty,
  Input,
  Segmented,
  Skeleton,
  Tag,
  Typography,
  theme,
} from "antd";
import { ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import dayjs, { type Dayjs } from "dayjs";
import { api } from "@/lib/api";
import { formatPrice, formatPhone } from "@/lib/format";

const { Text } = Typography;

/** A transaction row as returned by GET /orders. */
export interface TxOrder {
  id: string;
  ticketNumber?: number | null;
  customerName: string;
  customerPhone?: string | null;
  status: string;
  source?: string | null;
  orderType?: string | null;
  paidAt?: string | null;
  totalAmount: number;
  createdAt: string;
}

interface Summary {
  openCount: number;
  openTotal: number;
  salesTotal: number;
  salesCount: number;
  refundTotal: number;
  refundCount: number;
}

type RangeKey = "today" | "yesterday" | "7days" | "date";
type SourceKey = "ALL" | "AI_PHONE" | "POS" | "WEB";
type TypeKey = "ALL" | "dine_in" | "pickup" | "delivery";

/** An order is "open" while it is unpaid and still in an active status. */
const isOpenOrder = (o: TxOrder) =>
  !o.paidAt && ["pending", "confirmed"].includes(o.status);

/** Bucket the free-form source string into the drawer's filter chips. */
const sourceKey = (s?: string | null): SourceKey => {
  if (s === "ai_phone") return "AI_PHONE";
  if (s === "web") return "WEB";
  return "POS"; // 'pos' and legacy null both read as an in-store sale
};

const SOURCE_TAG: Record<SourceKey, { label: string; color?: string }> = {
  ALL: { label: "All" },
  AI_PHONE: { label: "AI PHONE", color: "blue" },
  POS: { label: "POS" },
  WEB: { label: "WEB", color: "geekblue" },
};

const ORDER_TYPE_LABEL: Record<string, string> = {
  dine_in: "Dine-in",
  pickup: "Pickup",
  delivery: "Delivery",
};

const TYPE_CHIPS: { key: TypeKey; label: string }[] = [
  { key: "ALL", label: "All" },
  { key: "dine_in", label: "Dine-in" },
  { key: "pickup", label: "Pickup" },
  { key: "delivery", label: "Delivery" },
];

function computeRange(
  key: RangeKey,
  customDate: Dayjs | null,
): { from: Date; to: Date } {
  const now = dayjs();
  switch (key) {
    case "yesterday": {
      const y = now.subtract(1, "day");
      return { from: y.startOf("day").toDate(), to: y.endOf("day").toDate() };
    }
    case "7days":
      return {
        from: now.subtract(6, "day").startOf("day").toDate(),
        to: now.endOf("day").toDate(),
      };
    case "date": {
      const d = customDate ?? now;
      return { from: d.startOf("day").toDate(), to: d.endOf("day").toDate() };
    }
    case "today":
    default:
      return { from: now.startOf("day").toDate(), to: now.endOf("day").toDate() };
  }
}

export default function TransactionsListDrawer({
  open,
  onClose,
  locationId,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  locationId: string | null;
  onSelect: (order: TxOrder) => void;
}) {
  const { token } = theme.useToken();
  const { message } = App.useApp();

  const [range, setRange] = useState<RangeKey>("today");
  const [customDate, setCustomDate] = useState<Dayjs | null>(dayjs());
  const [tab, setTab] = useState<"open" | "closed">("open");
  const [source, setSource] = useState<SourceKey>("ALL");
  const [orderType, setOrderType] = useState<TypeKey>("ALL");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  const [orders, setOrders] = useState<TxOrder[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(false);

  // Debounce the search box so each keystroke doesn't hit the API.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    if (!locationId) return;
    setLoading(true);
    const { from, to } = computeRange(range, customDate);
    const iso = { dateFrom: from.toISOString(), dateTo: to.toISOString() };
    const listParams = new URLSearchParams({
      locationId,
      ...iso,
      limit: "100",
    });
    if (debouncedSearch) listParams.set("q", debouncedSearch);
    const sumParams = new URLSearchParams({ locationId, ...iso });
    try {
      const [listRes, sumRes] = await Promise.all([
        api.get<{ data: TxOrder[] }>(`/orders?${listParams.toString()}`),
        api.get<Summary>(`/orders/summary?${sumParams.toString()}`),
      ]);
      setOrders(listRes.data.data ?? []);
      setSummary(sumRes.data);
    } catch {
      message.error("Failed to load transactions.");
    } finally {
      setLoading(false);
    }
  }, [locationId, range, customDate, debouncedSearch, message]);

  // Refetch whenever the drawer is open and a server-side filter changes.
  // Deferred a tick so the fetch's setState doesn't run synchronously inside
  // the effect (and to coalesce simultaneous filter changes).
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      load();
    }, 0);
    return () => clearTimeout(t);
  }, [open, load]);

  const openCount = useMemo(
    () => orders.filter(isOpenOrder).length,
    [orders],
  );

  const visible = useMemo(
    () =>
      orders.filter((o) => {
        const tabMatch = tab === "open" ? isOpenOrder(o) : !isOpenOrder(o);
        const srcMatch = source === "ALL" || sourceKey(o.source) === source;
        const typeMatch = orderType === "ALL" || o.orderType === orderType;
        return tabMatch && srcMatch && typeMatch;
      }),
    [orders, tab, source, orderType],
  );

  const stat = (label: string, value: string, accent?: string) => (
    <div style={{ flex: 1, minWidth: 0 }}>
      <Text
        type="secondary"
        style={{ fontSize: 12, display: "block", whiteSpace: "nowrap" }}
      >
        {label}
      </Text>
      <Text
        strong
        style={{
          fontSize: 20,
          color: accent,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </Text>
    </div>
  );

  return (
    <Drawer
      title="Transactions"
      placement="right"
      open={open}
      onClose={onClose}
      extra={
        <Button
          icon={<ReloadOutlined />}
          onClick={load}
          loading={loading}
          aria-label="Refresh transactions"
        >
          Refresh
        </Button>
      }
      styles={{ wrapper: { width: 452 }, body: { padding: 0, display: "flex", flexDirection: "column" } }}
    >
      {/* Filters header */}
      <div
        style={{
          padding: "16px 20px",
          display: "flex",
          flexDirection: "column",
          gap: token.marginSM,
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
        }}
      >
        <Segmented<RangeKey>
          value={range}
          onChange={(v) => setRange(v)}
          options={[
            { label: "Today", value: "today" },
            { label: "Yesterday", value: "yesterday" },
            { label: "7 Days", value: "7days" },
            { label: "Date", value: "date" },
          ]}
        />
        {range === "date" && (
          <DatePicker
            value={customDate}
            onChange={(d) => setCustomDate(d)}
            allowClear={false}
            style={{ width: "100%" }}
            aria-label="Pick a date"
          />
        )}

        {/* Summary metrics */}
        <div
          style={{
            display: "flex",
            gap: token.marginSM,
            background: token.colorFillAlter,
            border: `1px solid ${token.colorBorderSecondary}`,
            borderRadius: token.borderRadiusLG,
            padding: "12px 16px",
          }}
        >
          {stat("Open", String(summary?.openCount ?? 0))}
          {stat("Open Total", formatPrice(summary?.openTotal ?? 0))}
          {stat("Sales", formatPrice(summary?.salesTotal ?? 0), token.colorSuccess)}
          {stat("Refunds", formatPrice(summary?.refundTotal ?? 0))}
        </div>

        {/* Open / Closed */}
        <Segmented
          block
          value={tab}
          onChange={(v) => setTab(v as "open" | "closed")}
          options={[
            {
              value: "open",
              label: (
                <span>
                  Open{" "}
                  <Badge
                    count={openCount}
                    style={{ backgroundColor: token.colorPrimary }}
                  />
                </span>
              ),
            },
            { value: "closed", label: "Closed" },
          ]}
        />

        <Input
          allowClear
          prefix={<SearchOutlined />}
          placeholder="Order #, customer, or phone"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search transactions"
        />

        {/* Source chips (where the order came from) */}
        <div
          style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}
          role="group"
          aria-label="Filter by order source"
        >
          <Text
            type="secondary"
            style={{
              fontSize: 11,
              fontWeight: 600,
              textTransform: "uppercase",
              width: 52,
              whiteSpace: "nowrap",
            }}
          >
            Source
          </Text>
          {(["ALL", "AI_PHONE", "POS", "WEB"] as SourceKey[]).map((s) => {
            const active = source === s;
            return (
              <Button
                key={s}
                size="small"
                type={active ? "primary" : "text"}
                onClick={() => setSource(s)}
                aria-pressed={active}
                style={{ fontWeight: active ? 600 : 500 }}
              >
                {SOURCE_TAG[s].label}
              </Button>
            );
          })}
        </div>

        {/* Order-type chips (how the order is fulfilled) */}
        <div
          style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}
          role="group"
          aria-label="Filter by order type"
        >
          <Text
            type="secondary"
            style={{
              fontSize: 11,
              fontWeight: 600,
              textTransform: "uppercase",
              width: 52,
              whiteSpace: "nowrap",
            }}
          >
            Type
          </Text>
          {TYPE_CHIPS.map(({ key, label }) => {
            const active = orderType === key;
            return (
              <Button
                key={key}
                size="small"
                type={active ? "primary" : "text"}
                onClick={() => setOrderType(key)}
                aria-pressed={active}
                style={{ fontWeight: active ? 600 : 500 }}
              >
                {label}
              </Button>
            );
          })}
        </div>
      </div>

      {/* Transaction list */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          padding: "12px 20px",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        {loading && orders.length === 0 ? (
          <Skeleton active paragraph={{ rows: 6 }} />
        ) : visible.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              tab === "open"
                ? "No open transactions in this range."
                : "No closed transactions in this range."
            }
            style={{ marginTop: 40 }}
          />
        ) : (
          visible.map((o) => {
            const sk = sourceKey(o.source);
            const tag = SOURCE_TAG[sk];
            const statusTag =
              o.status === "cancelled"
                ? { color: "red", label: "Refunded" }
                : o.paidAt
                  ? { color: "green", label: "Paid" }
                  : { color: "gold", label: "Unpaid" };
            return (
              <div
                key={o.id}
                role="button"
                tabIndex={0}
                aria-label={`View transaction ${
                  o.ticketNumber != null ? `#${o.ticketNumber}` : o.id.slice(0, 6)
                }`}
                onClick={() => onSelect(o)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onSelect(o);
                }}
                style={{
                  border: `1px solid ${token.colorBorderSecondary}`,
                  borderRadius: token.borderRadiusLG,
                  padding: "12px 14px",
                  cursor: "pointer",
                  boxShadow: token.boxShadowTertiary,
                  transition: "border-color 0.15s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = token.colorPrimary;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = token.colorBorderSecondary;
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      minWidth: 0,
                    }}
                  >
                    <Text strong style={{ fontVariantNumeric: "tabular-nums" }}>
                      {o.ticketNumber != null
                        ? `#${o.ticketNumber}`
                        : `#${o.id.slice(0, 6)}`}
                    </Text>
                    <Tag color={tag.color} style={{ margin: 0 }}>
                      {tag.label}
                    </Tag>
                    {o.orderType && (
                      <Text type="secondary" style={{ fontSize: 13 }}>
                        {ORDER_TYPE_LABEL[o.orderType] ?? o.orderType}
                      </Text>
                    )}
                  </div>
                  <Text strong style={{ fontVariantNumeric: "tabular-nums" }}>
                    {formatPrice(o.totalAmount)}
                  </Text>
                </div>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 8,
                    marginTop: 6,
                  }}
                >
                  <Text
                    type="secondary"
                    style={{
                      fontSize: 13,
                      minWidth: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {o.customerName}
                    {o.customerPhone ? ` · ${formatPhone(o.customerPhone)}` : ""}
                  </Text>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      flexShrink: 0,
                    }}
                  >
                    <Tag color={statusTag.color} style={{ margin: 0 }}>
                      {statusTag.label}
                    </Tag>
                    <Text type="secondary" style={{ fontSize: 13 }}>
                      {new Date(o.createdAt).toLocaleTimeString([], {
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </Text>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </Drawer>
  );
}
