"use client";

import { useEffect, useState } from "react";
import {
  Drawer,
  Typography,
  Space,
  Button,
  Tag,
  Divider,
  Spin,
  App,
  Flex,
  Input,
  InputNumber,
  Modal,
  theme,
} from "antd";
import { PrinterOutlined, RollbackOutlined } from "@ant-design/icons";
import { api } from "@/lib/api";
import { formatPrice, formatPhone } from "@/lib/format";

const { Text, Title } = Typography;

interface OrderItem {
  id: string;
  menuItemId: string;
  menuItemName: string;
  quantity: number;
  price: number;
}

interface Order {
  id: string;
  ticketNumber?: number | null;
  customerName: string;
  customerPhone: string;
  status: string;
  totalAmount: number;
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

export default function TransactionDrawer({
  orderId,
  open,
  onClose,
  isAdmin,
  onChanged,
}: {
  orderId: string | null;
  open: boolean;
  onClose: () => void;
  isAdmin: boolean;
  /** Called after a mutation (status change, refund) so lists can refresh. */
  onChanged?: () => void;
}) {
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [printLoading, setPrintLoading] = useState(false);
  const [printerId, setPrinterId] = useState("");

  // Refund modal: mode 'full' voids/refunds the whole order, 'partial' takes an amount.
  const [refundMode, setRefundMode] = useState<"full" | "partial" | null>(null);
  const [refundPin, setRefundPin] = useState("");
  const [refundReason, setRefundReason] = useState("");
  const [refundAmount, setRefundAmount] = useState<number | null>(null); // dollars
  const [refundBusy, setRefundBusy] = useState(false);

  const loadOrder = (id: string) => {
    setLoading(true);
    api
      .get<Order>(`/orders/${id}`)
      .then(({ data }) => setOrder(data))
      .catch(() => message.error("Failed to load order details."))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!orderId || !open) return;
    let cancelled = false;
    // Microtask defer avoids synchronous setState in the effect body (lint rule).
    Promise.resolve().then(() => {
      if (cancelled) return;
      setLoading(true);
      api
        .get<Order>(`/orders/${orderId}`)
        .then(({ data }) => {
          if (!cancelled) setOrder(data);
        })
        .catch(() => {
          if (!cancelled) message.error("Failed to load order details.");
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    });
    return () => {
      cancelled = true;
    };
  }, [orderId, open, message]);

  const updateStatus = async (newStatus: string) => {
    if (!order) return;
    setActionLoading(true);
    try {
      const { data } = await api.patch<Order>(`/orders/${order.id}/status`, {
        status: newStatus,
      });
      message.success(`Order status updated to ${STATUS_LABEL[newStatus]}`);
      setOrder(data);
      onChanged?.();
    } catch {
      message.error("Failed to update status.");
    } finally {
      setActionLoading(false);
    }
  };

  const handlePrint = async () => {
    if (!order) return;
    setPrintLoading(true);
    try {
      await api.post(`/orders/${order.id}/print`, {
        printerId: printerId?.trim() || undefined,
      });
      message.success("Order dispatched to MQTT print queue!");
    } catch {
      message.error("Failed to enqueue print job.");
    } finally {
      setPrintLoading(false);
    }
  };

  const openRefund = (mode: "full" | "partial") => {
    setRefundMode(mode);
    setRefundPin("");
    setRefundReason("");
    setRefundAmount(
      mode === "partial" && order ? order.totalAmount / 100 : null,
    );
  };

  const submitRefund = async () => {
    if (!order || !refundMode) return;
    if (!/^[0-9]{4}$/.test(refundPin)) {
      message.warning("Enter the 4-digit manager PIN.");
      return;
    }
    const amountCents =
      refundMode === "partial" ? Math.round((refundAmount ?? 0) * 100) : 0;
    if (refundMode === "partial") {
      if (amountCents <= 0) {
        message.warning("Enter a refund amount.");
        return;
      }
      if (amountCents > order.totalAmount) {
        message.warning("Refund can't exceed the order total.");
        return;
      }
    }
    setRefundBusy(true);
    try {
      if (refundMode === "full") {
        await api.post(`/orders/${order.id}/refund`, {
          managerPin: refundPin,
          reason: refundReason.trim() || undefined,
        });
        message.success("Order voided and refunded.");
      } else {
        const { data } = await api.post<{ message: string }>(
          `/orders/${order.id}/refund-partial`,
          {
            managerPin: refundPin,
            amount: amountCents,
            reason: refundReason.trim() || undefined,
          },
        );
        message.success(data.message || "Partial refund issued.");
      }
      setRefundMode(null);
      loadOrder(order.id);
      onChanged?.();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? "Refund failed — nothing was changed.";
      message.error(Array.isArray(msg) ? msg.join(", ") : msg);
    } finally {
      setRefundBusy(false);
    }
  };

  const panelStyle: React.CSSProperties = {
    background: token.colorFillQuaternary,
    border: `1px solid ${token.colorBorderSecondary}`,
    padding: 16,
    borderRadius: token.borderRadius,
    marginBottom: 16,
  };
  const panelLabelStyle: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 600,
    color: token.colorTextTertiary,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    marginBottom: 12,
    display: "block",
  };

  const isRefundable =
    !!order && !!order.paidAt && order.status !== "cancelled";

  return (
    <Drawer
      title={null}
      placement="right"
      onClose={onClose}
      open={open}
      styles={{
        wrapper: { width: 400 },
        body: { padding: "24px 32px", background: token.colorBgContainer },
      }}
    >
      {loading ? (
        <div style={{ textAlign: "center", paddingTop: 40 }}>
          <Spin />
        </div>
      ) : order ? (
        <Flex vertical>
          {/* Header */}
          <div style={{ textAlign: "center", marginBottom: 24 }}>
            <Title
              level={4}
              style={{ margin: 0, fontFamily: "var(--font-mono)", fontWeight: 600 }}
            >
              {order.ticketNumber != null
                ? `#${order.ticketNumber}`
                : `#${order.id.slice(0, 6)}`}
            </Title>
            <Text type="secondary" style={{ fontSize: 13 }}>
              {new Date(order.createdAt).toLocaleString()}
            </Text>
          </div>

          <Divider
            style={{
              margin: "16px 0",
              borderBlockStart: `1px dashed ${token.colorBorderSecondary}`,
            }}
          />

          {/* Customer Info */}
          <div style={{ marginBottom: 16 }}>
            <Text style={{ display: "block", fontWeight: 600, fontSize: 14 }}>
              {order.customerName}
            </Text>
            <Text
              type="secondary"
              style={{
                display: "block",
                fontFamily: "var(--font-mono)",
                fontSize: 13,
              }}
            >
              {formatPhone(order.customerPhone)}
            </Text>
          </div>

          <div style={{ marginBottom: 24 }}>
            <Space size={4}>
              <Tag color={STATUS_COLOR[order.status] || "default"} style={{ margin: 0 }}>
                {STATUS_LABEL[order.status] || order.status}
              </Tag>
              {order.paidAt ? (
                <Tag color="green" style={{ margin: 0 }}>
                  Paid{order.paymentMethod ? ` · ${order.paymentMethod}` : ""}
                </Tag>
              ) : (
                <Tag style={{ margin: 0 }}>Unpaid</Tag>
              )}
            </Space>
          </div>

          <Divider
            style={{
              margin: "16px 0",
              borderBlockStart: `1px dashed ${token.colorBorderSecondary}`,
            }}
          />

          {/* Items */}
          <div style={{ flex: 1, minHeight: 150 }}>
            {order.items && order.items.length > 0 ? (
              order.items.map((item) => (
                <div
                  key={item.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    marginBottom: 12,
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <Text style={{ display: "block", fontSize: 14 }}>
                      {item.menuItemName}
                    </Text>
                    <Text
                      type="secondary"
                      style={{ fontSize: 12, fontFamily: "var(--font-mono)" }}
                    >
                      {item.quantity} × {formatPrice(item.price)}
                    </Text>
                  </div>
                  <div style={{ paddingLeft: 12 }}>
                    <Text style={{ fontFamily: "var(--font-mono)", fontSize: 14 }}>
                      {formatPrice(item.price * item.quantity)}
                    </Text>
                  </div>
                </div>
              ))
            ) : (
              <Text type="secondary" style={{ fontSize: 13 }}>
                No items in this order.
              </Text>
            )}
          </div>

          <Divider
            style={{
              margin: "16px 0",
              borderBlockStart: `1px dashed ${token.colorText}`,
            }}
          />

          {/* Total */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 24,
            }}
          >
            <Text style={{ fontSize: 16, fontWeight: 600 }}>Total</Text>
            <Text
              style={{
                fontSize: 24,
                fontWeight: 600,
                fontFamily: "var(--font-mono)",
              }}
            >
              {formatPrice(order.totalAmount)}
            </Text>
          </div>

          {/* Admin Actions */}
          {isAdmin && (
            <>
              <div style={panelStyle}>
                <Text style={panelLabelStyle}>Status Actions</Text>
                <Space orientation="vertical" style={{ width: "100%" }}>
                  <Button
                    block
                    onClick={() => updateStatus("preparing")}
                    disabled={order.status !== "pending" || actionLoading}
                  >
                    Start Preparing
                  </Button>
                  <Button
                    block
                    onClick={() => updateStatus("ready")}
                    disabled={order.status !== "preparing" || actionLoading}
                  >
                    Ready for Pickup
                  </Button>
                  <Button
                    block
                    onClick={() => updateStatus("completed")}
                    disabled={order.status !== "ready" || actionLoading}
                  >
                    Complete Order
                  </Button>
                  <Button
                    block
                    danger
                    onClick={() => updateStatus("cancelled")}
                    disabled={
                      ["completed", "cancelled"].includes(order.status) ||
                      actionLoading ||
                      !!order.paidAt // paid orders are cancelled via Refund, which reverses the payment
                    }
                  >
                    Cancel Order
                  </Button>
                </Space>
              </div>

              {isRefundable && (
                <div style={panelStyle}>
                  <Text style={panelLabelStyle}>Refunds</Text>
                  <Space orientation="vertical" style={{ width: "100%" }}>
                    <Button
                      block
                      danger
                      icon={<RollbackOutlined />}
                      onClick={() => openRefund("full")}
                    >
                      Refund Full Order ({formatPrice(order.totalAmount)})
                    </Button>
                    <Button block onClick={() => openRefund("partial")}>
                      Partial Refund…
                    </Button>
                  </Space>
                  <Text
                    type="secondary"
                    style={{ fontSize: 12, display: "block", marginTop: 8 }}
                  >
                    Requires a manager PIN. Full refunds void the order.
                  </Text>
                </div>
              )}

              <div style={{ ...panelStyle, marginBottom: 0 }}>
                <Text style={panelLabelStyle}>Print</Text>
                <Input
                  placeholder="Printer ID (Optional)"
                  value={printerId}
                  onChange={(e) => setPrinterId(e.target.value)}
                  style={{ marginBottom: 8 }}
                />
                <Button
                  block
                  onClick={handlePrint}
                  loading={printLoading}
                  icon={<PrinterOutlined />}
                >
                  Print Receipt
                </Button>
              </div>
            </>
          )}
        </Flex>
      ) : null}

      {/* Manager-authorized refund */}
      <Modal
        open={refundMode !== null}
        title={refundMode === "full" ? "Refund Full Order" : "Partial Refund"}
        onCancel={() => setRefundMode(null)}
        onOk={submitRefund}
        okText={
          refundMode === "full"
            ? `Refund ${order ? formatPrice(order.totalAmount) : ""}`
            : `Refund ${formatPrice(Math.round((refundAmount ?? 0) * 100))}`
        }
        okButtonProps={{ danger: true, loading: refundBusy }}
        destroyOnHidden
      >
        {refundMode === "full" && (
          <Text type="secondary" style={{ display: "block", marginBottom: 16 }}>
            The full payment is reversed and the order is voided. This can&apos;t
            be undone.
          </Text>
        )}
        {refundMode === "partial" && (
          <div style={{ marginBottom: 16 }}>
            <Text strong style={{ display: "block", marginBottom: 6 }}>
              Amount to refund
            </Text>
            <InputNumber
              min={0.01}
              max={order ? order.totalAmount / 100 : undefined}
              step={1}
              precision={2}
              prefix="$"
              value={refundAmount}
              onChange={(v) => setRefundAmount(v)}
              aria-label="Refund amount"
              size="large"
              style={{ width: "100%" }}
            />
          </div>
        )}
        <Text strong style={{ display: "block", marginBottom: 6 }}>
          Manager PIN
        </Text>
        <Input.OTP
          length={4}
          mask="●"
          value={refundPin}
          onChange={(v) => setRefundPin(v)}
          aria-label="Manager PIN"
        />
        <Text strong style={{ display: "block", margin: "16px 0 6px" }}>
          Reason (optional)
        </Text>
        <Input
          placeholder="e.g. wrong order, quality issue"
          value={refundReason}
          onChange={(e) => setRefundReason(e.target.value)}
          maxLength={255}
          aria-label="Refund reason"
        />
      </Modal>
    </Drawer>
  );
}
