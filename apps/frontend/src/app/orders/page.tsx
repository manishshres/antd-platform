"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Table,
  Tag,
  Button,
  Card,
  Typography,
  Space,
  Alert,
  Drawer,
  Descriptions,
  Divider,
  Tooltip,
  Input,
  Select,
  theme,
  App,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  PlusOutlined,
  PrinterOutlined,
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
  customerName: string;
  customerPhone: string;
  status: string; // 'pending', 'preparing', 'ready', 'completed', 'cancelled'
  totalAmount: number; // in cents
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

  // Detail Drawer
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

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

  const viewOrder = (order: Order) => {
    setSelectedOrder(order);
    setPrinterId("");
    setDetailLoading(true);
    api
      .get<Order>(`/orders/${order.id}`)
      .then(({ data }) => {
        setSelectedOrder(data);
      })
      .catch(() => message.error("Failed to load order details."))
      .finally(() => setDetailLoading(false));
  };

  const updateStatus = async (orderId: string, newStatus: string) => {
    setActionLoading(true);
    try {
      const { data } = await api.patch<Order>(`/orders/${orderId}/status`, {
        status: newStatus,
      });
      message.success(`Order status updated to ${STATUS_LABEL[newStatus]}`);

      // Update selected order detail view
      setSelectedOrder(data);

      // Reload main table
      load();
    } catch {
      message.error("Failed to update status.");
    } finally {
      setActionLoading(false);
    }
  };

  const [printLoading, setPrintLoading] = useState(false);
  const [printerId, setPrinterId] = useState("");

  const handlePrint = async (orderId: string, printerIdOverride?: string) => {
    setPrintLoading(true);
    try {
      await api.post(`/orders/${orderId}/print`, {
        printerId: printerIdOverride?.trim() || undefined,
      });
      message.success("Order dispatched to MQTT print queue!");
    } catch {
      message.error("Failed to enqueue print job.");
    } finally {
      setPrintLoading(false);
    }
  };

  interface LocalMenuItem {
    id: string;
    name: string;
    description: string;
    price: number;
    categoryId: string;
  }

  interface LocalCategory {
    id: string;
    name: string;
    items?: LocalMenuItem[];
  }

  // Generate a mock order for easy local developer testing
  const createMockOrder = async () => {
    try {
      // 1. Fetch the menu to see if we have items
      const { data: menuData } = await api.get<LocalCategory[]>("/menus");
      const allItems = (menuData || []).flatMap((cat) => cat.items || []);

      if (allItems.length === 0) {
        // Automatically create a mock category and item if menu is empty
        const cat = await api.post<{ id: string }>("/menus/categories", {
          name: "Mock Delicacies",
        });
        const item = await api.post<LocalMenuItem>("/menus/items", {
          categoryId: cat.data.id,
          name: "Signature Pepperoni Pizza",
          description: "Freshly baked pizza with authentic pepperoni slices",
          price: 1499,
        });
        allItems.push(item.data);
      }

      // 2. Create the mock order using the first menu item
      const itemToOrder = allItems[0];
      await api.post("/orders", {
        locationId: selectedLocationId,
        customerName: "Alice Smith",
        customerPhone: "+15551234567",
        items: [
          {
            menuItemId: itemToOrder.id,
            quantity: 2,
          },
        ],
      });

      message.success("Mock order created successfully!");
      load();
    } catch (err: unknown) {
      const errorMsg =
        err instanceof Error ? err.message : "Make sure menu items exist.";
      message.error(`Failed to create mock order: ${errorMsg}`);
    }
  };

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
      render: (_: unknown, record: Order) => (
        <Button size='small' onClick={() => viewOrder(record)}>
          Details
        </Button>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Restaurant Orders"
        subtitle="View customer orders placed via AI webhooks."
        actions={
          <Tooltip title='Create a Mock Order to test the database and UI'>
            <Button type='dashed' icon={<PlusOutlined />} onClick={createMockOrder}>
              Create Mock Order
            </Button>
          </Tooltip>
        }
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

      {/* Order Details Drawer */}
      <Drawer
        title={`Order Details`}
        styles={{ wrapper: { width: 480 } }}
        placement='right'
        onClose={() => setSelectedOrder(null)}
        open={!!selectedOrder}
        loading={detailLoading}
      >
        {selectedOrder && (
          <Space orientation='vertical' size='large' style={{ width: "100%" }}>
            <Descriptions column={1} size='small' bordered>
              <Descriptions.Item label='Order ID'>
                <Text copyable style={{ fontSize: 12 }}>
                  {selectedOrder.id}
                </Text>
              </Descriptions.Item>
              <Descriptions.Item label='Customer'>
                {selectedOrder.customerName}
              </Descriptions.Item>
              <Descriptions.Item label='Phone'>
                {formatPhone(selectedOrder.customerPhone)}
              </Descriptions.Item>
              <Descriptions.Item label='Status'>
                <Tag color={STATUS_COLOR[selectedOrder.status] || "default"}>
                  {STATUS_LABEL[selectedOrder.status] || selectedOrder.status}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label='Total Price'>
                <Text style={{ fontWeight: 600 }}>
                  {formatPrice(selectedOrder.totalAmount)}
                </Text>
              </Descriptions.Item>
            </Descriptions>

            <div>
              <Title level={5} style={{ marginBottom: 12 }}>
                Order Items
              </Title>
              {selectedOrder.items && selectedOrder.items.length > 0 ? (
                selectedOrder.items.map((item) => (
                  <div
                    key={item.id}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      marginBottom: token.marginSM,
                    }}
                  >
                    <div>
                      <Text style={{ fontWeight: 500 }}>
                        {item.menuItemName}
                      </Text>
                      <div>
                        <Text type='secondary' style={{ fontSize: 12 }}>
                          {item.quantity} × {formatPrice(item.price)}
                        </Text>
                      </div>
                    </div>
                    <Text style={{ fontVariantNumeric: "tabular-nums" }}>
                      {formatPrice(item.price * item.quantity)}
                    </Text>
                  </div>
                ))
              ) : (
                <Text type='secondary'>No items in this order.</Text>
              )}
            </div>

            {isAdmin && (
              <>
                <Divider style={{ margin: `${token.marginSM}px 0` }} />

                <div>
                  <Title level={5} style={{ marginBottom: token.marginSM }}>
                    Manage Order Status
                  </Title>
                  <Space wrap size={8}>
                    <Button
                      onClick={() => updateStatus(selectedOrder.id, "preparing")}
                      disabled={selectedOrder.status !== "pending" || actionLoading}
                      type='primary'
                    >
                      Start Preparing
                    </Button>
                    <Button
                      onClick={() => updateStatus(selectedOrder.id, "ready")}
                      disabled={
                        selectedOrder.status !== "preparing" || actionLoading
                      }
                      color='cyan'
                      variant='solid'
                    >
                      Ready for Pickup
                    </Button>
                    <Button
                      onClick={() => updateStatus(selectedOrder.id, "completed")}
                      disabled={selectedOrder.status !== "ready" || actionLoading}
                      color='green'
                      variant='solid'
                    >
                      Complete Order
                    </Button>
                    <Button
                      onClick={() => updateStatus(selectedOrder.id, "cancelled")}
                      disabled={
                        ["completed", "cancelled"].includes(selectedOrder.status) ||
                        actionLoading
                      }
                      danger
                    >
                      Cancel Order
                    </Button>
                  </Space>
                </div>

                <Divider style={{ margin: `${token.marginSM}px 0` }} />

                <div>
                  <Title level={5} style={{ marginBottom: token.marginSM }}>
                    MQTT Print Job
                  </Title>
                  <Input
                    placeholder="Optional printer ID / subtopic (leave blank for all)"
                    value={printerId}
                    onChange={(event) => setPrinterId(event.target.value)}
                    style={{ marginBottom: token.marginSM }}
                    allowClear
                  />
                  <Button
                    onClick={() => handlePrint(selectedOrder.id, printerId)}
                    loading={printLoading}
                    icon={<PrinterOutlined />}
                    type='primary'
                    style={{ width: "100%" }}
                  >
                    Send to Kitchen &amp; Receipt Printers
                  </Button>
                </div>
              </>
            )}
          </Space>
        )}
      </Drawer>
    </>
  );
}
