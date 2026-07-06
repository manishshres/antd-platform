"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Alert,
  App,
  Badge,
  Button,
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
  CopyOutlined,
  CreditCardOutlined,
  DeleteOutlined,
  DollarOutlined,
  EditOutlined,
  LeftOutlined,
  MinusOutlined,
  RightOutlined,
  PlusOutlined,
  SaveOutlined,
  SearchOutlined,
  ShoppingCartOutlined,
  StarFilled,
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
  isFavorite?: boolean;
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

/** Shape of the order returned by GET /orders/:id (fields the register needs). */
interface ExistingOrder {
  id: string;
  ticketNumber?: number | null;
  customerName: string;
  status: string;
  source?: string | null;
  paidAt?: string | null;
  orderType?: string | null;
  specialInstructions?: string | null;
  items: {
    menuItemId: string;
    menuItemName: string;
    quantity: number;
    price: number;
    notes?: string | null;
    modifiers?: {
      optionId?: string;
      modifier: string;
      option: string;
      priceAdjustment: number;
    }[];
  }[];
}

const FAVORITES_ID = "__favorites__";

const fmtMoney = (cents: number) => `$${(cents / 100).toFixed(2)}`;

const orderLabel = (o: { ticketNumber?: number | null; id: string }) =>
  o.ticketNumber != null ? `#${o.ticketNumber}` : `#${o.id.slice(0, 8)}`;

function PosRegister() {
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const router = useRouter();
  const searchParams = useSearchParams();
  const editOrderId = searchParams.get("orderId");
  const { selectedLocationId, selectedLocation } = useLocation();

  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCatId, setSelectedCatId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const [cart, setCart] = useState<CartLine[]>([]);
  const [orderType, setOrderType] = useState<string>("dine_in");
  const [customerName, setCustomerName] = useState("");
  const [orderNotes, setOrderNotes] = useState("");
  const [charging, setCharging] = useState<"cash" | "card" | null>(null);
  const [saving, setSaving] = useState(false);

  // Loaded existing order (AI voice handoff / edit mode)
  const [editingOrder, setEditingOrder] = useState<ExistingOrder | null>(null);

  // Modifier picker state; editingLineKey means "replace that cart line" on confirm.
  const [pickerItem, setPickerItem] = useState<MenuItem | null>(null);
  const [pickerSelections, setPickerSelections] = useState<
    Record<string, string | undefined>
  >({});
  const [pickerNotes, setPickerNotes] = useState("");
  const [editingLineKey, setEditingLineKey] = useState<string | null>(null);

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

  // Hydrate the register from an existing order (?orderId=...) — the AI voice handoff.
  useEffect(() => {
    // No sync state reset needed when orderId is absent: every navigation back
    // to /pos (save, pay, cancel-edit) already calls resetRegister() first.
    if (!editOrderId) return;
    let cancelled = false;
    api
      .get<ExistingOrder>(`/orders/${editOrderId}`)
      .then(({ data }) => {
        if (cancelled) return;
        if (data.paidAt) {
          message.warning(
            `Order ${orderLabel(data)} is already paid and can no longer be edited.`,
          );
          router.replace("/pos");
          return;
        }
        setEditingOrder(data);
        setCustomerName(data.customerName === "Walk-in" ? "" : data.customerName);
        setOrderType(data.orderType ?? "dine_in");
        setOrderNotes(data.specialInstructions ?? "");
        setCart(
          data.items.map((item, idx) => {
            const options: CartOption[] = (item.modifiers ?? []).map((m) => ({
              id: m.optionId ?? "",
              name: m.option,
              priceAdjustment: m.priceAdjustment,
              groupName: m.modifier,
            }));
            return {
              key: `loaded-${idx}-${item.menuItemId}`,
              menuItemId: item.menuItemId,
              name: item.menuItemName,
              unitPrice: item.price,
              quantity: item.quantity,
              options,
              notes: item.notes ?? undefined,
            };
          }),
        );
      })
      .catch(() => {
        if (!cancelled) {
          message.error("Failed to load the order.");
          router.replace("/pos");
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editOrderId]);

  const allItems = useMemo(
    () =>
      categories.flatMap((c) => (c.items ?? []).filter((i) => !i.deletedAt)),
    [categories],
  );
  const favoriteItems = useMemo(
    () => allItems.filter((i) => i.isFavorite),
    [allItems],
  );
  const hasFavorites = favoriteItems.length > 0;

  const searchQuery = search.trim().toLowerCase();
  const visibleItems = useMemo(() => {
    if (searchQuery) {
      return allItems.filter((i) => i.name.toLowerCase().includes(searchQuery));
    }
    if (selectedCatId === FAVORITES_ID) return favoriteItems;
    const cat = categories.find((c) => c.id === selectedCatId);
    return (cat?.items ?? []).filter((i) => !i.deletedAt);
  }, [searchQuery, allItems, selectedCatId, favoriteItems, categories]);

  const subtotal = useMemo(
    () => cart.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0),
    [cart],
  );
  // Mirror of the server-side calculation — the backend recomputes and is authoritative.
  const taxRateBps = selectedLocation?.taxRateBps ?? 0;
  const taxAmount = Math.round((subtotal * taxRateBps) / 10000);
  const total = subtotal + taxAmount;

  // Category pill strip: hidden scrollbar, arrow buttons + drag/touch scrolling.
  const pillsRef = useRef<HTMLDivElement>(null);
  const drag = useRef({ active: false, startX: 0, startScroll: 0 });
  const scrollPills = (dir: -1 | 1) => {
    pillsRef.current?.scrollBy({ left: dir * 280, behavior: "smooth" });
  };

  const resetRegister = () => {
    setCart([]);
    setCustomerName("");
    setOrderNotes("");
    setOrderType("dine_in");
    setEditingOrder(null);
  };

  const buildLine = (
    item: MenuItem,
    options: CartOption[],
    notes?: string,
  ): CartLine => {
    const optionsKey = options
      .map((o) => o.id)
      .sort()
      .join(",");
    return {
      key: `${item.id}|${optionsKey}|${notes ?? ""}`,
      menuItemId: item.id,
      name: item.name,
      unitPrice:
        item.price + options.reduce((s, o) => s + o.priceAdjustment, 0),
      quantity: 1,
      options,
      notes,
    };
  };

  const addLine = (item: MenuItem, options: CartOption[], notes?: string) => {
    const line = buildLine(item, options, notes);
    setCart((prev) => {
      const existing = prev.find((l) => l.key === line.key);
      if (existing) {
        return prev.map((l) =>
          l.key === line.key ? { ...l, quantity: l.quantity + 1 } : l,
        );
      }
      return [...prev, line];
    });
  };

  const openPicker = (
    item: MenuItem,
    selections: Record<string, string | undefined>,
    notes: string,
    lineKey: string | null,
  ) => {
    setPickerItem(item);
    setPickerSelections(selections);
    setPickerNotes(notes);
    setEditingLineKey(lineKey);
  };

  const handleItemTap = (item: MenuItem) => {
    if (!item.isAvailable) return;
    // Always open the picker — even items without modifier groups can take
    // per-item kitchen notes ("no onions", "extra spicy", ...).
    openPicker(item, {}, "", null);
  };

  // Tap a cart line → reopen the picker prefilled with that line's selections.
  const handleLineTap = (line: CartLine) => {
    const item = allItems.find((i) => i.id === line.menuItemId);
    if (!item) {
      message.warning("This item is no longer on the menu, so it can't be edited.");
      return;
    }
    const selections: Record<string, string | undefined> = {};
    for (const group of item.modifiers ?? []) {
      const chosen = line.options.find((o) =>
        group.options.some((go) => go.id === o.id),
      );
      if (chosen) selections[group.id] = chosen.id;
    }
    openPicker(item, selections, line.notes ?? "", line.key);
  };

  const duplicateLine = (line: CartLine) => {
    setCart((prev) => [
      ...prev,
      { ...line, key: `${line.key}#${Date.now()}`, quantity: 1 },
    ]);
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
    const notes = pickerNotes.trim() || undefined;
    if (editingLineKey) {
      const replacement = buildLine(pickerItem, options, notes);
      setCart((prev) =>
        prev.map((l) =>
          l.key === editingLineKey
            ? { ...replacement, key: l.key, quantity: l.quantity }
            : l,
        ),
      );
    } else {
      addLine(pickerItem, options, notes);
    }
    setPickerItem(null);
    setEditingLineKey(null);
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

  const cartPayloadItems = () =>
    cart.map((l) => ({
      menuItemId: l.menuItemId,
      quantity: l.quantity,
      optionIds: l.options.map((o) => o.id).filter(Boolean),
      notes: l.notes,
    }));

  const saveChanges = async () => {
    if (!editingOrder || cart.length === 0) return;
    setSaving(true);
    try {
      await api.put(`/orders/${editingOrder.id}/items`, {
        customerName: customerName.trim() || undefined,
        orderType,
        specialInstructions: orderNotes.trim() || undefined,
        items: cartPayloadItems(),
      });
      message.success(
        `Order ${orderLabel(editingOrder)} updated — corrected ticket sent to kitchen.`,
        5,
      );
      resetRegister();
      router.replace("/pos");
    } catch {
      message.error("Failed to update the order.");
    } finally {
      setSaving(false);
    }
  };

  const charge = async (method: "cash" | "card") => {
    if (!selectedLocationId || cart.length === 0) return;
    setCharging(method);
    try {
      let paid: { ticketNumber?: number | null; id: string; totalAmount: number };
      if (editingOrder) {
        // Persist any edits, then record the payment on the existing order.
        await api.put(`/orders/${editingOrder.id}/items`, {
          customerName: customerName.trim() || undefined,
          orderType,
          specialInstructions: orderNotes.trim() || undefined,
          items: cartPayloadItems(),
        });
        const res = await api.post<typeof paid>(
          `/orders/${editingOrder.id}/pay`,
          { paymentMethod: method },
        );
        paid = res.data;
      } else {
        const res = await api.post<typeof paid>("/orders/pos", {
          locationId: selectedLocationId,
          orderType,
          paymentMethod: method,
          customerName: customerName.trim() || undefined,
          specialInstructions: orderNotes.trim() || undefined,
          items: cartPayloadItems(),
        });
        paid = res.data;
      }
      message.success(
        `Order ${orderLabel(paid)} paid with ${method} — ${fmtMoney(paid.totalAmount)}. Ticket sent to kitchen.`,
        5,
      );
      resetRegister();
      if (editingOrder) router.replace("/pos");
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

  const pills: { id: string; name: string; icon?: React.ReactNode }[] = [
    ...(hasFavorites
      ? [{ id: FAVORITES_ID, name: "Favorites", icon: <StarFilled /> }]
      : []),
    ...categories.map((c) => ({ id: c.id, name: c.name })),
  ];

  return (
    <div>
      <PageHeader
        title="POS Register"
        subtitle={
          editingOrder
            ? `Editing order ${orderLabel(editingOrder)}`
            : "Ring up in-store orders"
        }
      />

      {editingOrder && (
        <Alert
          type="info"
          showIcon
          title={`Editing order ${orderLabel(editingOrder)}${
            editingOrder.source === "ai_phone" ? " — placed by AI phone agent" : ""
          }. It is unpaid; adjust items, then Save or take payment.`}
          action={
            <Button
              size="small"
              onClick={() => {
                resetRegister();
                router.replace("/pos");
              }}
            >
              Cancel edit
            </Button>
          }
          style={{ marginBottom: token.marginSM }}
        />
      )}

      <div
        style={{
          display: "flex",
          gap: token.marginSM,
          alignItems: "stretch",
          // Lock the register to 70% of the viewport: the page never scrolls,
          // the item grid and cart scroll independently.
          height: "70vh",
          minHeight: 420,
          overflow: "hidden",
        }}
      >
        {/* Items area: search + category pills on top, grid below */}
        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            gap: token.marginSM,
          }}
        >
          <Input
            allowClear
            size="large"
            prefix={<SearchOutlined />}
            placeholder="Search menu..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search menu"
            style={{ flexShrink: 0 }}
          />

          {/* Category pills — hidden scrollbar; arrows + drag/touch to scroll */}
          {!searchQuery && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                flexShrink: 0,
              }}
            >
              <Button
                shape="circle"
                icon={<LeftOutlined />}
                aria-label="Scroll categories left"
                onClick={() => scrollPills(-1)}
              />
              <div
                ref={pillsRef}
                className="pos-pill-strip"
                role="tablist"
                aria-label="Menu categories"
                onPointerDown={(e) => {
                  drag.current = {
                    active: true,
                    startX: e.clientX,
                    startScroll: pillsRef.current?.scrollLeft ?? 0,
                  };
                }}
                onPointerMove={(e) => {
                  if (!drag.current.active || !pillsRef.current) return;
                  pillsRef.current.scrollLeft =
                    drag.current.startScroll -
                    (e.clientX - drag.current.startX);
                }}
                onPointerUp={() => {
                  drag.current.active = false;
                }}
                onPointerLeave={() => {
                  drag.current.active = false;
                }}
                style={{
                  display: "flex",
                  gap: 8,
                  overflowX: "auto",
                  flex: 1,
                  minWidth: 0,
                  cursor: "grab",
                }}
              >
                {pills.map((pill) => {
                  const active = pill.id === selectedCatId;
                  return (
                    <Button
                      key={pill.id}
                      role="tab"
                      aria-selected={active}
                      type={active ? "primary" : "default"}
                      shape="round"
                      size="large"
                      icon={pill.icon}
                      onClick={() => setSelectedCatId(pill.id)}
                      style={{
                        flexShrink: 0,
                        fontWeight: active ? 600 : 500,
                        height: 44,
                        paddingInline: 20,
                      }}
                    >
                      {pill.name}
                    </Button>
                  );
                })}
              </div>
              <Button
                shape="circle"
                icon={<RightOutlined />}
                aria-label="Scroll categories right"
                onClick={() => scrollPills(1)}
              />
            </div>
          )}

          {/* Item grid */}
          <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
            {visibleItems.length === 0 ? (
              <Empty
                description={
                  searchQuery
                    ? `No items match “${search.trim()}”.`
                    : "No items in this category."
                }
              />
            ) : (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
                  gap: token.marginSM,
                }}
              >
                {visibleItems.map((item) => (
                  <div
                    key={item.id}
                    onClick={() => handleItemTap(item)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ")
                        handleItemTap(item);
                    }}
                    aria-label={`Add ${item.name}`}
                    style={{
                      cursor: item.isAvailable ? "pointer" : "not-allowed",
                      opacity: item.isAvailable ? 1 : 0.45,
                      userSelect: "none",
                      background: token.colorBgContainer,
                      border: `1px solid ${token.colorBorderSecondary}`,
                      borderRadius: token.borderRadiusLG,
                      padding: token.paddingSM,
                      minHeight: 104,
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "space-between",
                      transition: "border-color 0.15s, box-shadow 0.15s",
                    }}
                    onMouseEnter={(e) => {
                      if (!item.isAvailable) return;
                      e.currentTarget.style.borderColor = token.colorPrimary;
                      e.currentTarget.style.boxShadow =
                        token.boxShadowTertiary;
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor =
                        token.colorBorderSecondary;
                      e.currentTarget.style.boxShadow = "none";
                    }}
                  >
                    <Space size={4} align="start">
                      {item.isFavorite && (
                        <StarFilled
                          style={{ color: token.colorWarning, fontSize: 12 }}
                        />
                      )}
                      <Text
                        strong
                        style={{ fontSize: 14, lineHeight: 1.35 }}
                        ellipsis={{ tooltip: item.name }}
                      >
                        {item.name}
                      </Text>
                    </Space>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        marginTop: 8,
                      }}
                    >
                      <Text
                        strong
                        style={{ fontSize: 14, color: token.colorPrimary }}
                      >
                        {fmtMoney(item.price)}
                      </Text>
                      {!item.isAvailable ? (
                        <Tag color="red" style={{ margin: 0 }}>
                          86&apos;d
                        </Tag>
                      ) : (item.modifiers?.length ?? 0) > 0 ? (
                        <Tag style={{ margin: 0 }}>options</Tag>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
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
              <Text strong>
                {editingOrder
                  ? `Order ${orderLabel(editingOrder)}`
                  : "Current Order"}
              </Text>
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

          <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
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
                    role="button"
                    tabIndex={0}
                    aria-label={`Edit ${line.name}`}
                    onClick={() => handleLineTap(line)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleLineTap(line);
                    }}
                    style={{ cursor: "pointer" }}
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
                  </div>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginTop: 4,
                    }}
                  >
                    <Space>
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
                    <Space size={0}>
                      <Button
                        size="small"
                        type="text"
                        icon={<EditOutlined />}
                        aria-label={`Edit options for ${line.name}`}
                        onClick={() => handleLineTap(line)}
                      />
                      <Button
                        size="small"
                        type="text"
                        icon={<CopyOutlined />}
                        aria-label={`Duplicate ${line.name}`}
                        onClick={() => duplicateLine(line)}
                      />
                    </Space>
                  </div>
                </div>
              ))
            )}
          </div>

          <Divider style={{ margin: "8px 0" }} />
          <Input.TextArea
            rows={2}
            placeholder="Order instructions (optional) — e.g. allergy, rush"
            value={orderNotes}
            onChange={(e) => setOrderNotes(e.target.value)}
            maxLength={1000}
            aria-label="Order instructions"
            style={{ marginBottom: token.marginXS }}
          />
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginBottom: 2,
            }}
          >
            <Text type="secondary">Subtotal</Text>
            <Text type="secondary">{fmtMoney(subtotal)}</Text>
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginBottom: 4,
            }}
          >
            <Text type="secondary">
              Tax{taxRateBps > 0 ? ` (${(taxRateBps / 100).toFixed(2)}%)` : ""}
            </Text>
            <Text type="secondary">{fmtMoney(taxAmount)}</Text>
          </div>
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
              {fmtMoney(total)}
            </Title>
          </div>
          {editingOrder && (
            <Button
              size="large"
              icon={<SaveOutlined />}
              disabled={cart.length === 0 || charging !== null}
              loading={saving}
              onClick={saveChanges}
              aria-label="Save order changes"
              style={{ marginBottom: token.marginXS }}
            >
              Save Changes (kitchen re-fires)
            </Button>
          )}
          <Space.Compact block>
            <Button
              type="primary"
              size="large"
              icon={<DollarOutlined />}
              disabled={cart.length === 0 || charging !== null || saving}
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
              disabled={cart.length === 0 || charging !== null || saving}
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
        onCancel={() => {
          setPickerItem(null);
          setEditingLineKey(null);
        }}
        onOk={confirmPicker}
        okText={editingLineKey ? "Update item" : "Add to order"}
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
              {!group.isRequired && <Radio value={undefined}>No thanks</Radio>}
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

export default function PosPage() {
  // useSearchParams requires a Suspense boundary during prerender.
  return (
    <Suspense fallback={<Skeleton active paragraph={{ rows: 10 }} />}>
      <PosRegister />
    </Suspense>
  );
}
