"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Alert,
  Breadcrumb,
  Button,
  Card,
  DatePicker,
  Dropdown,
  Input,
  Select,
  Skeleton,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
  theme,
} from "antd";
import type { ColumnsType, TableProps } from "antd/es/table";
import type { TableRowSelection } from "antd/es/table/interface";
import type { MenuProps } from "antd";
import {
  DownOutlined,
  DownloadOutlined,
  EyeOutlined,
  HomeOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import { api } from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { useLocation } from "@/contexts/LocationContext";
import type { Dayjs } from "dayjs";
import type { CallRecord } from "@platform/shared-types";

const { Text } = Typography;
const { RangePicker } = DatePicker;

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatDuration(ms: number) {
  if (!ms) return "—";
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

function formatPhone(raw: string) {
  if (!raw) return "—";
  const d = raw.replace(/\D/g, "");
  if (d.length === 11 && d[0] === "1") {
    return `+1 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  }
  return raw;
}

const STATUS_COLOR: Record<string, string> = {
  completed: "success",
  failed: "error",
  error: "error",
  missed: "warning",
  "in-progress": "processing",
};

const STATUS_LABEL: Record<string, string> = {
  completed: "Completed",
  failed: "Failed",
  error: "Failed",
  missed: "Missed",
  "in-progress": "In Progress",
};

function statusColor(s: string): string {
  return STATUS_COLOR[s] ?? "default";
}

function statusLabel(s: string): string {
  return STATUS_LABEL[s] ?? (s ? s.charAt(0).toUpperCase() + s.slice(1) : "—");
}

// ── CSV Export ─────────────────────────────────────────────────────────────────

function exportCsv(data: CallRecord[]) {
  const headers = [
    "Caller",
    "To",
    "Date & Time",
    "Duration",
    "Status",
    "Call ID",
  ];
  const rows = data.map((r) => [
    formatPhone(r.from),
    formatPhone(r.to),
    r.startedAt ? new Date(r.startedAt).toLocaleString() : "—",
    formatDuration(r.durationMs || 0),
    statusLabel(r.status),
    r.id,
  ]);

  const csv = [headers, ...rows]
    .map((row) =>
      row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","),
    )
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `call-logs-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function CallsPage() {
  const router = useRouter();

  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);

  const { token } = theme.useToken();

  const { selectedLocationId } = useLocation();

  // Filters
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<[Dayjs, Dayjs] | null>(null);

  const load = useCallback(() => {
    if (!selectedLocationId) {
      setCalls([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    api
      .get<{ data: CallRecord[] }>("/calls", { params: { search, locationId: selectedLocationId } })
      .then(({ data }) => {
        setCalls(Array.isArray(data.data) ? data.data : Array.isArray(data) ? data : []);
        setError(null);
      })
      .catch(() => setError("Failed to load call logs."))
      .finally(() => setLoading(false));
  }, [search, selectedLocationId]);

  useEffect(() => {
    load();
  }, [load]);

  // ── Filtered data ──────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    return calls.filter((r) => {
      if (search) {
        const q = search.toLowerCase();
        if (
          !r.from?.toLowerCase().includes(q) &&
          !r.to?.toLowerCase().includes(q)
        )
          return false;
      }
      if (statusFilter && r.status !== statusFilter) return false;
      if (dateRange) {
        const ts = r.startedAt ? new Date(r.startedAt).getTime() : 0;
        const from = dateRange[0].startOf("day").valueOf();
        const to = dateRange[1].endOf("day").valueOf();
        if (ts < from || ts > to) return false;
      }
      return true;
    });
  }, [calls, search, statusFilter, dateRange]);

  // ── Unique statuses for the filter dropdown ────────────────────────────────
  const statusOptions = useMemo(() => {
    const seen = new Set<string>();
    calls.forEach((r) => {
      if (r.status) seen.add(r.status);
    });
    return Array.from(seen).map((s) => ({ value: s, label: statusLabel(s) }));
  }, [calls]);

  const hasActiveFilters = !!(search || statusFilter || dateRange);

  const clearFilters = () => {
    setSearch("");
    setStatusFilter(null);
    setDateRange(null);
  };

  // ── Row selection ──────────────────────────────────────────────────────────
  const rowSelection: TableRowSelection<CallRecord> = {
    selectedRowKeys,
    onChange: (keys) => setSelectedRowKeys(keys),
  };

  const exportTarget =
    selectedRowKeys.length > 0
      ? filtered.filter((r) => selectedRowKeys.includes(r.id))
      : filtered;

  const exportLabel =
    selectedRowKeys.length > 0
      ? `Export ${selectedRowKeys.length} selected`
      : `Export ${filtered.length} rows`;

  // ── Row action dropdown items ──────────────────────────────────────────────
  const rowActions = (record: CallRecord): MenuProps["items"] => [
    {
      key: "view",
      label: "View Details",
      icon: <EyeOutlined />,
      onClick: ({ domEvent }) => {
        domEvent.stopPropagation();
        router.push(`/calls/${record.id}`);
      },
    },
    { type: "divider" },
    {
      key: "copy-id",
      label: "Copy Call ID",
      onClick: ({ domEvent }) => {
        domEvent.stopPropagation();
        navigator.clipboard.writeText(record.id);
      },
    },
    {
      key: "export-row",
      label: "Export This Row",
      onClick: ({ domEvent }) => {
        domEvent.stopPropagation();
        exportCsv([record]);
      },
    },
  ];

  // ── Columns ────────────────────────────────────────────────────────────────
  const columns: ColumnsType<CallRecord> = [
    {
      title: "Caller",
      dataIndex: "from",
      ellipsis: true,
      render: (v: string) => (
        <Text style={{ whiteSpace: "nowrap", fontWeight: 500 }}>
          {formatPhone(v)}
        </Text>
      ),
    },
    {
      title: "To",
      dataIndex: "to",
      ellipsis: true,
      render: (v: string) => (
        <Text type='secondary' style={{ whiteSpace: "nowrap" }}>
          {formatPhone(v)}
        </Text>
      ),
    },
    {
      title: <div style={{ textAlign: "right" }}>Date &amp; Time</div>,
      dataIndex: "startedAt",
      width: 160,
      align: "right",
      sorter: (a, b) =>
        (a.startedAt ? new Date(a.startedAt).getTime() : 0) -
        (b.startedAt ? new Date(b.startedAt).getTime() : 0),
      defaultSortOrder: "descend",
      render: (v: string) => {
        if (!v) return <Text type='secondary'>—</Text>;
        const d = new Date(v);
        return (
          <div style={{ lineHeight: 1.4, textAlign: "right" }}>
            <Text
              style={{ display: "block", whiteSpace: "nowrap", fontSize: 13 }}
            >
              {d.toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </Text>
            <Text
              type='secondary'
              style={{ display: "block", fontSize: 12, whiteSpace: "nowrap" }}
            >
              {d.toLocaleTimeString("en-US", {
                hour: "numeric",
                minute: "2-digit",
              })}
            </Text>
          </div>
        );
      },
    },
    {
      title: <div style={{ textAlign: "right" }}>Duration</div>,
      dataIndex: "durationMs",
      width: 110,
      align: "right",
      sorter: (a, b) => (a.durationMs ?? 0) - (b.durationMs ?? 0),
      render: (v: number) => (
        <Text
          style={{ whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}
        >
          {formatDuration(v)}
        </Text>
      ),
    },
    {
      title: "Status",
      dataIndex: "status",
      width: 130,
      render: (s: string) => (
        <Tag color={statusColor(s)} style={{ fontWeight: 500 }}>
          {statusLabel(s)}
        </Tag>
      ),
    },
    {
      title: "Action",
      key: "action",
      width: 110,
      align: "center",
      render: (_: unknown, record: CallRecord) => (
        <Dropdown
          menu={{ items: rowActions(record) }}
          trigger={["click"]}
          placement='bottomRight'
        >
          <Button
            size='small'
            onClick={(e) => e.stopPropagation()}
            style={{ minWidth: 82 }}
          >
            Manage <DownOutlined style={{ fontSize: 11 }} />
          </Button>
        </Dropdown>
      ),
    },
  ];

  const tableProps: TableProps<CallRecord> = {
    columns,
    dataSource: filtered,
    rowKey: "id",
    size: "middle",
    rowSelection,
    onRow: (record) => ({
      onClick: () => router.push(`/calls/${record.id}`),
      style: { cursor: "pointer" },
    }),
    rowClassName: () => "calls-table-row",
    pagination: {
      showSizeChanger: true,
      pageSizeOptions: ["10", "25", "50", "100"],
      defaultPageSize: 25,
      showTotal: (total, range) => `${range[0]}–${range[1]} of ${total} calls`,
      placement: ["bottomEnd"],
    },
    locale: { emptyText: "No call logs found." },
    scroll: { x: 700 },
  };

  return (
    <>
      <style>{`
        .calls-table-row:hover td { background: #f5f7ff !important; transition: background 0.15s; }
      `}</style>


      <PageHeader
        title="AI Phone Calls"
        subtitle="View and inspect all your AI call history."
      />

      {error && (
        <Alert
          type='error'
          title={error}
          showIcon
          style={{ marginBottom: token.marginSM }}
          action={
            <Button size='small' onClick={load}>
              Retry
            </Button>
          }
        />
      )}

      <Card
        styles={{ body: { padding: "16px 24px" } }}
        style={{ borderRadius: 8 }}
      >
        {/* ── Toolbar ── */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: token.marginSM,
            marginBottom: token.marginSM,
          }}
        >
          {/* Left: search + filters */}
          <Space size={8} wrap>
            <Input.Search
              placeholder='Search caller or destination…'
              allowClear
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onSearch={setSearch}
              style={{ width: 240 }}
            />
            <RangePicker
              value={dateRange}
              onChange={(val) => setDateRange(val as [Dayjs, Dayjs] | null)}
              style={{ width: 230 }}
              placeholder={["Start date", "End date"]}
              allowClear
            />
            <Select
              placeholder='All statuses'
              allowClear
              value={statusFilter}
              onChange={(val) => setStatusFilter(val ?? null)}
              options={statusOptions}
              style={{ width: 150 }}
            />
            {hasActiveFilters && (
              <Button
                type='link'
                size='small'
                onClick={clearFilters}
                style={{ padding: 0 }}
              >
                Clear filters
              </Button>
            )}
            {!loading && (
              <Text type='secondary' style={{ fontSize: 13 }}>
                {filtered.length} result{filtered.length !== 1 ? "s" : ""}
                {selectedRowKeys.length > 0 && (
                  <Text type='secondary'>
                    {" "}
                    · {selectedRowKeys.length} selected
                  </Text>
                )}
              </Text>
            )}
          </Space>

          {/* Right: refresh + export */}
          <Space size={8}>
            <Tooltip title='Refresh'>
              <Button
                icon={<ReloadOutlined />}
                onClick={load}
                loading={loading}
              />
            </Tooltip>
            <Tooltip title={exportLabel}>
              <Button
                type='primary'
                icon={<DownloadOutlined />}
                onClick={() => exportCsv(exportTarget)}
                disabled={exportTarget.length === 0}
              >
                Export
              </Button>
            </Tooltip>
          </Space>
        </div>

        {/* ── Table ── */}
        {loading ? (
          <div
            style={{ display: "flex", justifyContent: "center", padding: 60 }}
          >
            <Skeleton active paragraph={{ rows: 10 }} />
          </div>
        ) : (
          <Table {...tableProps} />
        )}
      </Card>
    </>
  );
}
