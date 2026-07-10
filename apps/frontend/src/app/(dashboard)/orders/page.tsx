"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Table,
  Tag,
  Button,
  Card,
  Typography,
  Space,
  Alert,
  Dropdown,
  MenuProps,
  Descriptions,
  Divider,
  Input,
  Select,
  DatePicker,
  Tooltip,
  theme,
  App,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  PrinterOutlined,
  ShopOutlined,
  DownOutlined,
  EditOutlined,
  EyeOutlined,
} from "@ant-design/icons";
import { api } from "@/lib/api";
import { getAccessToken } from "@/lib/token-store";
import { decodeRoleFromToken } from "@/lib/jwt";
import PageHeader from "@/components/PageHeader";
import TableToolbar from "@/components/TableToolbar";
import { useLocation } from "@/contexts/LocationContext";
import { useSocket } from "@/hooks/useSocket";
import { formatPrice, formatPhone } from "@/lib/format";

const { Title, Text } = Typography;

interface OrderItem {
  id: string;
  menuItemId: string;
  menuItemName: string;
  quantity: number;
  price: number; // in cents
}

interface Order {
  id: string;
  ticketNumber?: number | null;
  customerName: string;
  customerPhone: string;
  status: string; // 'pending', 'preparing', 'ready', 'completed', 'cancelled'
  totalAmount: number; // in cents
  source?: string | null;
  paymentMethod?: string | null;
  paidAt?: string | null;
  createdAt: string;
  items?: OrderItem[];
}

const STATUS_COLOR: Record<string, string> = {
  pending: "gold",
  preparing: "blue",
  ready: "cyan",
  completed: "green",
  cancelled: "red",
};

const STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  preparing: "Preparing",
  ready: "Ready for Pickup",
  completed: "Completed",
  cancelled: "Cancelled",
};



interface PaginatedOrders {
  data: Order[];
  total: number;
  hasMore: boolean;
}

export default function OrdersPage() {
  const { message, notification } = App.useApp();
  const router = useRouter();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Server-side pagination state
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [total, setTotal] = useState(0);

  // Server-side history filters: search hits ticket #, customer name, and phone
  // across ALL orders (not just the loaded page); debounced to avoid a request
  // per keystroke.
  const [search, setSearch] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [dateRange, setDateRange] = useState<[string, string] | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
       
      setDebouncedQ(search.trim());
      setPage(1);
    }, 400);
    return () => clearTimeout(t);
  }, [search]);

  const [isAdmin, setIsAdmin] = useState(false);
  
  const { selectedLocationId } = useLocation();
  const { socket, isConnected, connect } = useSocket();

  // Connect socket on mount for realtime order updates.
  useEffect(() => {
    connect();
  }, [connect]);
  const { token } = theme.useToken();

  const exportCsv = () => {
    if (!selectedLocationId) return;
    const params = new URLSearchParams({ locationId: selectedLocationId });
    if (debouncedQ) params.set("q", debouncedQ);
    if (statusFilter) params.set("status", statusFilter);
    if (dateRange?.[0]) params.set("dateFrom", dateRange[0]);
    if (dateRange?.[1]) params.set("dateTo", dateRange[1]);
    const token = getAccessToken();
    const baseUrl = process.env.NEXT_PUBLIC_API_URL || "/api/v1";
    const url = `${baseUrl}/orders/export/csv?${params.toString()}`;
    // Create a hidden anchor to trigger download with Bearer auth
    const a = document.createElement("a");
    a.href = url;
    a.download = `orders-${new Date().toISOString().slice(0, 10)}.csv`;
    // For bearer auth, we use a fetch-based download
    fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((res) => res.blob())
      .then((blob) => {
        const blobUrl = URL.createObjectURL(blob);
        a.href = blobUrl;
        a.click();
        URL.revokeObjectURL(blobUrl);
      })
      .catch(() => {
        message.error("Export failed. Please try again.");
      });
  };

  const load = useCallback(() => {
    if (!selectedLocationId) {
      setOrders([]);
      setTotal(0);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const offset = (page - 1) * pageSize;
    // Server-side history search: ticket #, customer name/phone, status, date range.
    const params = new URLSearchParams({
      locationId: selectedLocationId,
      offset: String(offset),
      limit: String(pageSize),
    });
    if (debouncedQ) params.set("q", debouncedQ);
    if (statusFilter) params.set("status", statusFilter);
    if (dateRange?.[0]) params.set("dateFrom", dateRange[0]);
    if (dateRange?.[1]) params.set("dateTo", dateRange[1]);
    // The backend returns a paginated envelope { data, total, hasMore }; consume it directly
    // and drive the AntD Table from the server total (H1).
    api
      .get<PaginatedOrders>(`/orders?${params.toString()}`)
      .then(({ data }) => {
        setOrders(Array.isArray(data?.data) ? data.data : []);
        setTotal(typeof data?.total === "number" ? data.total : 0);
      })
      .catch(() => setError("Failed to load orders."))
      .finally(() => setLoading(false));
  }, [selectedLocationId, page, pageSize, debouncedQ, statusFilter, dateRange]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    if (typeof window !== "undefined") {
      const token = getAccessToken();
      if (token) {
        setIsAdmin(["admin", "sysadmin"].includes(decodeRoleFromToken(token).toLowerCase()));
      } else {
        setIsAdmin(false);
      }
    }
  }, [load]);

  useEffect(() => {
    if (!socket) return;
    
    const handleOrderCreated = (order: Order) => {
      notification.info({
        message: "New Order Received",
        description: `Order for ${order.customerName} - ${formatPrice(order.totalAmount)}`,
        placement: "topRight",
      });
      load();
    };

    const handleOrderUpdated = (order: Order) => {
      // Don't show toast if we are currently viewing this order, or maybe we do want to show it.
      // But definitely reload the list.
      notification.success({
        message: "Order Status Updated",
        description: `Order for ${order.customerName} is now ${STATUS_LABEL[order.status] || order.status}`,
        placement: "topRight",
      });
      load();
    };

    socket.on("order.created", handleOrderCreated);
    socket.on("order.updated", handleOrderUpdated);

    return () => {
      socket.off("order.created", handleOrderCreated);
      socket.off("order.updated", handleOrderUpdated);
    };
  }, [socket, load, notification]);


  const columns: ColumnsType<Order> = [
    {
      title: "Order",
      dataIndex: "ticketNumber",
      width: 90,
      render: (v: number | null | undefined, record: Order) => (
        <Space size={4} orientation='vertical'>
          <Text strong>{v != null ? `#${v}` : `#${record.id.slice(0, 6)}`}</Text>
          {record.source === "pos" ? (
            <Tag style={{ margin: 0 }}>POS</Tag>
          ) : record.source === "ai_phone" ? (
            <Tag color='blue' style={{ margin: 0 }}>
              AI
            </Tag>
          ) : null}
        </Space>
      ),
    },
    {
      title: "Customer",
      dataIndex: "customerName",
      render: (v: string, record: Order) => (
        <div>
          <Text style={{ fontWeight: 600 }}>{v}</Text>
          <div style={{ fontSize: 12 }}>
            <Text type='secondary'>{formatPhone(record.customerPhone)}</Text>
          </div>
        </div>
      ),
    },
    {
      title: "Date & Time",
      dataIndex: "createdAt",
      render: (v: string) => {
        if (!v) return "—";
        return new Date(v).toLocaleString("en-US", {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        });
      },
    },
    {
      title: "Total Price",
      dataIndex: "totalAmount",
      align: "right",
      render: (v: number) => (
        <Text style={{ fontVariantNumeric: "tabular-nums", fontWeight: 500 }}>
          {formatPrice(v)}
        </Text>
      ),
    },
    {
      title: "Status",
      dataIndex: "status",
      render: (s: string) => (
        <Tag color={STATUS_COLOR[s] || "default"}>
          {STATUS_LABEL[s] || s.toUpperCase()}
        </Tag>
      ),
    },
    {
      title: "Action",
      key: "action",
      align: "center",
      render: (_: unknown, record: Order) => {
        const canEdit =
          !record.paidAt && ["pending", "confirmed"].includes(record.status);

        const items: MenuProps["items"] = [
          {
            key: "details",
            label: "View Details",
            icon: <EyeOutlined />,
            onClick: () => router.push(`/orders/${record.id}`),
          },
        ];

        if (canEdit) {
          items.unshift({
            key: "edit",
            label: "Edit in POS",
            icon: <EditOutlined />,
            onClick: () => router.push(`/pos?orderId=${record.id}`),
          });
        }

        return (
          <Dropdown menu={{ items }} trigger={["click"]}>
            <Button size="small">
              Actions <DownOutlined />
            </Button>
          </Dropdown>
        );
      },
    },
  ];

  return (
    <>
      <PageHeader
        title="Restaurant Orders"
        subtitle="View customer orders placed via AI webhooks."
      />

      {error && (
        <Alert
          type='error'
          title={error}
          showIcon
          style={{ marginBottom: token.marginSM }}
        />
      )}

      <Card variant="borderless">
        <TableToolbar
          search={search}
          onSearchChange={setSearch}
          searchPlaceholder="Search ticket #, customer, or phone…"
          searchAlign="right"
          filters={
            <Space>
              <Select
                allowClear
                placeholder="All statuses"
                value={statusFilter || undefined}
                onChange={(v) => {
                  setStatusFilter(v ?? "");
                  setPage(1);
                }}
                style={{ width: 160 }}
                options={Object.entries(STATUS_LABEL).map(([value, label]) => ({
                  value,
                  label,
                }))}
              />
              <DatePicker.RangePicker
                allowClear
                aria-label="Filter by date range"
                onChange={(_, dateStrings) => {
                  setDateRange(
                    dateStrings[0] ? [dateStrings[0], dateStrings[1]] : null,
                  );
                  setPage(1);
                }}
              />
            </Space>
          }
          onExport={orders.length > 0 ? exportCsv : undefined}
          onRefresh={load}
        />
        <Table
          columns={columns}
          dataSource={orders}
          rowKey='id'
          loading={loading}
          sticky
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            showTotal: (t) => `${t} orders`,
            onChange: (nextPage, nextSize) => {
              setPage(nextPage);
              setPageSize(nextSize);
            },
          }}
          locale={{
            emptyText:
              "No orders found. Click 'Create Mock Order' to generate one.",
          }}
        />
      </Card>


    </>
  );
}
