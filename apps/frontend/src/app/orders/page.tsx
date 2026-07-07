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

  // Quick client-side filters over the loaded page (E2 toolbar)
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");

  const [isAdmin, setIsAdmin] = useState(false);
  
  const { selectedLocationId } = useLocation();
  const { socket } = useSocket();
  const { token } = theme.useToken();

  const exportCsv = () => {
    const headers = ["Order ID", "Customer", "Phone", "Status", "Total", "Created"];
    const rows = orders.map((o) => [
      o.id,
      o.customerName,
      formatPhone(o.customerPhone),
      STATUS_LABEL[o.status] || o.status,
      formatPrice(o.totalAmount),
      o.createdAt ? new Date(o.createdAt).toLocaleString() : "",
    ]);
    const csv = [headers, ...rows]
      .map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `orders-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
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
    // The backend returns a paginated envelope { data, total, hasMore }; consume it directly
    // and drive the AntD Table from the server total (H1).
    api
      .get<PaginatedOrders>(
        `/orders?locationId=${selectedLocationId}&offset=${offset}&limit=${pageSize}`,
      )
      .then(({ data }) => {
        setOrders(Array.isArray(data?.data) ? data.data : []);
        setTotal(typeof data?.total === "number" ? data.total : 0);
      })
      .catch(() => setError("Failed to load orders."))
      .finally(() => setLoading(false));
  }, [selectedLocationId, page, pageSize]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    if (typeof window !== "undefined") {
      const token = localStorage.getItem("access_token");
      if (token) {
        try {
          const payload = token.split(".")[1];
          const decoded = JSON.parse(window.atob(payload.replace(/-/g, "+").replace(/_/g, "/"))) as { role?: string };
          setIsAdmin(["admin", "sysadmin"].includes(decoded.role?.toLowerCase() || ""));
        } catch {
          setIsAdmin(false);
        }
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

  const q = search.trim().toLowerCase();
  const displayedOrders = orders.filter((o) => {
    if (statusFilter && o.status !== statusFilter) return false;
    if (!q) return true;
    return (
      o.customerName?.toLowerCase().includes(q) ||
      o.customerPhone?.toLowerCase().includes(q)
    );
  });

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
          searchPlaceholder="Search customer or phone…"
          searchAlign="right"
          filters={
            <Select
              allowClear
              placeholder="All statuses"
              value={statusFilter || undefined}
              onChange={(v) => setStatusFilter(v ?? "")}
              style={{ width: 180 }}
              options={Object.entries(STATUS_LABEL).map(([value, label]) => ({
                value,
                label,
              }))}
            />
          }
          onExport={orders.length > 0 ? exportCsv : undefined}
          onRefresh={load}
        />
        <Table
          columns={columns}
          dataSource={displayedOrders}
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
