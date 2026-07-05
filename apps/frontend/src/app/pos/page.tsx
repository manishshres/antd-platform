"use client";

import { useEffect, useMemo, useState } from "react";
import {
  App,
  Badge,
  Button,
  Card,
  Divider,
  Empty,
  Input,
  Modal,
  Radio,
  Segmented,
  Skeleton,
  Space,
  Tag,
  Typography,
  theme,
} from "antd";
import {
  CreditCardOutlined,
  DeleteOutlined,
  DollarOutlined,
  MinusOutlined,
  PlusOutlined,
  ShoppingCartOutlined,
} from "@ant-design/icons";
import { api } from "@/lib/api";
import { useLocation } from "@/contexts/LocationContext";
import PageHeader from "@/components/PageHeader";
import { EmptyState, ErrorState } from "@/components/PageStates";

const { Text, Title } = Typography;

interface ModifierOption {
  id: string;
  name: string;
  priceAdjustment: number;
}

interface ModifierGroup {
  id: string;
  name: string;
  isRequired: boolean;
  options: ModifierOption[];
}

interface MenuItem {
  id: string;
  name: string;
  description: string;
  price: number;
  categoryId: string;
  isAvailable: boolean;
  deletedAt?: string | null;
  modifiers?: ModifierGroup[];
}

interface Category {
  id: string;
  name: string;
  isAvailable: boolean;
  deletedAt?: string | null;
  items?: MenuItem[];
}

interface CartOption {
  id: string;
  name: string;
  priceAdjustment: number;
  groupName: string;
}

interface CartLine {
  key: string;
  menuItemId: string;
  name: string;
  unitPrice: number; // cents, incl. selected options
  quantity: number;
  options: CartOption[];
  notes?: string;
}

const fmtMoney = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export default function PosPage() {
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const { selectedLocationId } = useLocation();

  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCatId, setSelectedCatId] = useState<string | null>(null);

  const [cart, setCart] = useState<CartLine[]>([]);
  const [orderType, setOrderType] = useState<string>("dine_in");
  const [customerName, setCustomerName] = useState("");
  const [charging, setCharging] = useState<"cash" | "card" | null>(null);

  // Modifier picker state
  const [pickerItem, setPickerItem] = useState<MenuItem | null>(null);
  const [pickerSelections, setPickerSelections] = useState<
    Record<string, string | undefined>
  >({});
  const [pickerNotes, setPickerNotes] = useState("");

  useEffect(() => {
    if (!selectedLocationId) return;
    let cancelled = false;
    api
      .get<{ data: Category[] }>(
        // Pagination is per-category and PaginationDto caps limit at 100.
        `/menus?locationId=${selectedLocationId}&limit=100`,
      )
      .then(({ data }) => {
        if (cancelled) return;
        const cats = (data.data ?? []).filter((c) => !c.deletedAt);
        setCategories(cats);
        setSelectedCatId((prev) => prev ?? cats[0]?.id ?? null);
      })
      .catch(() => {
        if (!cancelled) setError("Failed to load the menu.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedLocationId]);

  const selectedCat = categories.find((c) => c.id === selectedCatId) ?? null;
  const visibleItems = (selectedCat?.items ?? []).filter((i) => !i.deletedAt);

  const subtotal = useMemo(
    () => cart.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0),
    [cart],
  );

  const addLine = (item: MenuItem, options: CartOption[], notes?: string) => {
    const optionsKey = options
      .map((o) => o.id)
      .sort()
      .join(",");
    const key = `${item.id}|${optionsKey}|${notes ?? ""}`;
    const unitPrice =
      item.price + options.reduce((s, o) => s + o.priceAdjustment, 0);
    setCart((prev) => {
      const existing = prev.find((l) => l.key === key);
      if (existing) {
        return prev.map((l) =>
          l.key === key ? { ...l, quantity: l.quantity + 1 } : l,
        );
      }
      return [
        ...prev,
        {
          key,
          menuItemId: item.id,
          name: item.name,
          unitPrice,
          quantity: 1,
          options,
          notes,
        },
      ];
    });
  };

  const handleItemTap = (item: MenuItem) => {
    if (!item.isAvailable) return;
    const groups = item.modifiers ?? [];
    if (groups.length === 0) {
      addLine(item, []);
      return;
    }
    setPickerItem(item);
    setPickerSelections({});
    setPickerNotes("");
  };

  const confirmPicker = () => {
    if (!pickerItem) return;
    const groups = pickerItem.modifiers ?? [];
    for (const g of groups) {
      if (g.isRequired && !pickerSelections[g.id]) {
        message.warning(`Please choose a ${g.name}.`);
        return;
      }
    }
    const options: CartOption[] = [];
    for (const g of groups) {
      const optId = pickerSelections[g.id];
      if (!optId) continue;
      const opt = g.options.find((o) => o.id === optId);
      if (opt) {
        options.push({
          id: opt.id,
          name: opt.name,
          priceAdjustment: opt.priceAdjustment,
          groupName: g.name,
        });
      }
    }
    addLine(pickerItem, options, pickerNotes.trim() || undefined);
    setPickerItem(null);
  };

  const updateQty = (key: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((l) =>
          l.key === key ? { ...l, quantity: l.quantity + delta } : l,
        )
        .filter((l) => l.quantity > 0),
    );
  };

  const charge = async (method: "cash" | "card") => {
    if (!selectedLocationId || cart.length === 0) return;
    setCharging(method);
    try {
      const res = await api.post<{ id: string; totalAmount: number }>(
        "/orders/pos",
        {
          locationId: selectedLocationId,
          orderType,
          paymentMethod: method,
          customerName: customerName.trim() || undefined,
          items: cart.map((l) => ({
            menuItemId: l.menuItemId,
            quantity: l.quantity,
            optionIds: l.options.map((o) => o.id),
            notes: l.notes,
          })),
        },
      );
      message.success(
        `Order #${res.data.id.slice(0, 8)} paid with ${method} — ${fmtMoney(res.data.totalAmount)}. Ticket sent to kitchen.`,
        5,
      );
      setCart([]);
      setCustomerName("");
    } catch {
      message.error("Failed to place the order. Nothing was charged.");
    } finally {
      setCharging(null);
    }
  };

  if (!selectedLocationId && !loading) {
    return <EmptyState description="Select a location to open the register." />;
  }
  if (error) {
    return (
      <ErrorState message={error} onRetry={() => window.location.reload()} />
    );
  }
  if (loading) {
    return <Skeleton active paragraph={{ rows: 10 }} />;
  }

  return (
    <div>
      <PageHeader title="POS Register" subtitle="Ring up in-store orders" />

      <div
        style={{
          display: "flex",
          gap: token.marginSM,
          alignItems: "stretch",
          minHeight: "calc(100vh - 220px)",
        }}
      >
        {/* Category rail */}
        <div
          style={{
            width: 168,
            flexShrink: 0,
            display: "flex",
            flexDirection: "column",
            gap: 8,
            overflowY: "auto",
          }}
        >
          {categories.map((cat) => {
            const active = cat.id === selectedCatId;
            return (
              <Button
                key={cat.id}
                type={active ? "primary" : "default"}
                onClick={() => setSelectedCatId(cat.id)}
                aria-label={`Category ${cat.name}`}
                style={{
                  height: 56,
                  whiteSpace: "normal",
                  fontWeight: active ? 600 : 400,
                }}
              >
                {cat.name}
              </Button>
            );
          })}
        </div>

        {/* Item grid */}
        <div style={{ flex: 1, overflowY: "auto" }}>
          {visibleItems.length === 0 ? (
            <Empty description="No items in this category." />
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
                gap: token.marginSM,
              }}
            >
              {visibleItems.map((item) => (
                <Card
                  key={item.id}
                  hoverable={item.isAvailable}
                  onClick={() => handleItemTap(item)}
                  aria-label={`Add ${item.name}`}
                  styles={{ body: { padding: token.paddingSM } }}
                  style={{
                    cursor: item.isAvailable ? "pointer" : "not-allowed",
                    opacity: item.isAvailable ? 1 : 0.45,
                    minHeight: 96,
                    userSelect: "none",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                    }}
                  >
                    <Text strong style={{ fontSize: 14 }}>
                      {item.name}
                    </Text>
                    <Text type="secondary" style={{ fontSize: 13 }}>
                      {fmtMoney(item.price)}
                    </Text>
                    {(item.modifiers?.length ?? 0) > 0 && (
                      <Tag style={{ width: "fit-content" }}>options</Tag>
                    )}
                    {!item.isAvailable && <Tag color="red">86&apos;d</Tag>}
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>

        {/* Cart panel */}
        <div
          style={{
            width: 340,
            flexShrink: 0,
            display: "flex",
            flexDirection: "column",
            background: token.colorBgContainer,
            border: `1px solid ${token.colorBorderSecondary}`,
            borderRadius: token.borderRadiusLG,
            padding: token.paddingSM,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: token.marginXS,
            }}
          >
            <Space>
              <ShoppingCartOutlined style={{ color: token.colorPrimary }} />
              <Text strong>Current Order</Text>
              <Badge count={cart.reduce((s, l) => s + l.quantity, 0)} />
            </Space>
            {cart.length > 0 && (
              <Button
                size="small"
                type="text"
                danger
                icon={<DeleteOutlined />}
                aria-label="Clear order"
                onClick={() => setCart([])}
              />
            )}
          </div>

          <Segmented
            block
            value={orderType}
            onChange={(v) => setOrderType(v as string)}
            options={[
              { label: "Dine-in", value: "dine_in" },
              { label: "Pickup", value: "pickup" },
            ]}
            style={{ marginBottom: token.marginXS }}
          />
          <Input
            placeholder="Customer name (optional)"
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            aria-label="Customer name"
            style={{ marginBottom: token.marginXS }}
          />

          <div style={{ flex: 1, overflowY: "auto" }}>
            {cart.length === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="Tap items to add them"
                style={{ marginTop: 48 }}
              />
            ) : (
              cart.map((line) => (
                <div
                  key={line.key}
                  style={{
                    padding: "8px 0",
                    borderBottom: `1px solid ${token.colorBorderSecondary}`,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 8,
                    }}
                  >
                    <Text strong style={{ fontSize: 13, flex: 1 }}>
                      {line.name}
                    </Text>
                    <Text style={{ fontSize: 13 }}>
                      {fmtMoney(line.unitPrice * line.quantity)}
                    </Text>
                  </div>
                  {line.options.length > 0 && (
                    <Text
                      type="secondary"
                      style={{ fontSize: 12, display: "block" }}
                    >
                      {line.options
                        .map(
                          (o) =>
                            `${o.name}${o.priceAdjustment ? ` (+${fmtMoney(o.priceAdjustment)})` : ""}`,
                        )
                        .join(" · ")}
                    </Text>
                  )}
                  {line.notes && (
                    <Text
                      type="secondary"
                      italic
                      style={{ fontSize: 12, display: "block" }}
                    >
                      “{line.notes}”
                    </Text>
                  )}
                  <Space style={{ marginTop: 4 }}>
                    <Button
                      size="small"
                      icon={<MinusOutlined />}
                      aria-label={`Remove one ${line.name}`}
                      onClick={() => updateQty(line.key, -1)}
                    />
                    <Text style={{ minWidth: 20, textAlign: "center" }}>
                      {line.quantity}
                    </Text>
                    <Button
                      size="small"
                      icon={<PlusOutlined />}
                      aria-label={`Add one ${line.name}`}
                      onClick={() => updateQty(line.key, 1)}
                    />
                  </Space>
                </div>
              ))
            )}
          </div>

          <Divider style={{ margin: "8px 0" }} />
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginBottom: token.marginXS,
            }}
          >
            <Title level={5} style={{ margin: 0 }}>
              Total
            </Title>
            <Title level={5} style={{ margin: 0 }}>
              {fmtMoney(subtotal)}
            </Title>
          </div>
          <Space.Compact block>
            <Button
              type="primary"
              size="large"
              icon={<DollarOutlined />}
              disabled={cart.length === 0 || charging !== null}
              loading={charging === "cash"}
              onClick={() => charge("cash")}
              aria-label="Charge cash"
              style={{ flex: 1, height: 56 }}
            >
              Cash
            </Button>
            <Button
              type="primary"
              size="large"
              icon={<CreditCardOutlined />}
              disabled={cart.length === 0 || charging !== null}
              loading={charging === "card"}
              onClick={() => charge("card")}
              aria-label="Charge card"
              style={{ flex: 1, height: 56 }}
            >
              Card
            </Button>
          </Space.Compact>
        </div>
      </div>

      {/* Modifier picker */}
      <Modal
        open={pickerItem !== null}
        title={pickerItem?.name}
        onCancel={() => setPickerItem(null)}
        onOk={confirmPicker}
        okText="Add to order"
        destroyOnHidden
      >
        {(pickerItem?.modifiers ?? []).map((group) => (
          <div key={group.id} style={{ marginBottom: token.margin }}>
            <Text strong>
              {group.name}{" "}
              {group.isRequired ? (
                <Tag color="red">required</Tag>
              ) : (
                <Tag>optional</Tag>
              )}
            </Text>
            <Radio.Group
              value={pickerSelections[group.id]}
              onChange={(e) =>
                setPickerSelections((prev) => ({
                  ...prev,
                  [group.id]: e.target.value as string,
                }))
              }
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 6,
                marginTop: 6,
              }}
            >
              {!group.isRequired && (
                <Radio value={undefined}>No thanks</Radio>
              )}
              {group.options.map((opt) => (
                <Radio key={opt.id} value={opt.id}>
                  {opt.name}
                  {opt.priceAdjustment !== 0 && (
                    <Text type="secondary">
                      {" "}
                      (+{fmtMoney(opt.priceAdjustment)})
                    </Text>
                  )}
                </Radio>
              ))}
            </Radio.Group>
          </div>
        ))}
        <Input.TextArea
          rows={2}
          placeholder="Kitchen note (optional)"
          value={pickerNotes}
          onChange={(e) => setPickerNotes(e.target.value)}
          maxLength={500}
          aria-label="Kitchen note"
        />
      </Modal>
    </div>
  );
}
