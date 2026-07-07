"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Alert,
  App,
  Badge,
  Button,
  Checkbox,
  Divider,
  Drawer,
  Empty,
  Input,
  InputNumber,
  Modal,
  Radio,
  Segmented,
  Skeleton,
  Space,
  Tag,
  Tooltip,
  Typography,
  theme,
} from "antd";
import {
  ClockCircleOutlined,
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
  TagOutlined,
  UserOutlined,
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
  multiSelect?: boolean;
  maxSelections?: number | null;
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
  course?: number;
}

interface Discount {
  id: string;
  name: string;
  code?: string | null;
  type: string; // 'percent' | 'fixed'
  value: number; // percent (10 = 10%) or cents
  requiresManager: boolean;
}

/** Row in the Open Orders drawer — unpaid orders waiting to be settled/edited. */
interface OpenOrderRow {
  id: string;
  ticketNumber?: number | null;
  customerName: string;
  customerPhone: string;
  status: string;
  source?: string | null;
  paidAt?: string | null;
  totalAmount: number;
  createdAt: string;
}

/** Table on a floor plan, with live status from the tables endpoint. */
interface FloorTable {
  id: string;
  name: string;
  capacity?: number | null;
  shape?: string | null; // 'circle' | 'rect'
  posX?: number | null;
  posY?: number | null;
  status?: string | null; // 'available' | 'occupied' | 'billed'
  activeOrderTotal?: number | null;
}

interface FloorPlan {
  id: string;
  name: string;
  tables?: FloorTable[];
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
  discountId?: string | null;
  tipAmount?: number | null;
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
  const { selectedLocationId, selectedLocation, userRole } = useLocation();
  // Manager-only discounts are role-gated until PIN-based user switching lands.
  const canApplyManagerDiscounts = userRole !== "user";

  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCatId, setSelectedCatId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const [cart, setCart] = useState<CartLine[]>([]);
  const [orderType, setOrderType] = useState<string>("dine_in");

  // Floor plan / Table management
  const [viewMode, setViewMode] = useState<"menu" | "floor_plan">("menu");
  const [floorPlans, setFloorPlans] = useState<FloorPlan[]>([]);
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);

  const [customerName, setCustomerName] = useState("");
  const [orderNotes, setOrderNotes] = useState("");
  const [charging, setCharging] = useState<"cash" | "card" | null>(null);
  const [saving, setSaving] = useState(false);

  // Tender extras: discounts (fetched once) and tip selection.
  const [discounts, setDiscounts] = useState<Discount[]>([]);
  const [appliedDiscountId, setAppliedDiscountId] = useState<string | null>(
    null,
  );
  const [discountModalOpen, setDiscountModalOpen] = useState(false);
  const [promoInput, setPromoInput] = useState("");
  // Tip: percent of the discounted subtotal, or -1 for a custom dollar amount.
  const [tipPct, setTipPct] = useState<number>(0);
  const [customTip, setCustomTip] = useState<number>(0); // dollars
  // Tender step (Square/Toast pattern): tip + discount + payment live in a
  // dedicated modal opened by the big Charge button, keeping the cart clean.
  const [tenderOpen, setTenderOpen] = useState(false);
  const [showCustomer, setShowCustomer] = useState(false);
  const [showNote, setShowNote] = useState(false);
  // Tender payment step: choose method, cash-tendered/change screen, or split.
  const [payStep, setPayStep] = useState<"select" | "cash" | "split">("select");
  const [cashReceived, setCashReceived] = useState<number | null>(null); // dollars
  // Split-check state: the order being settled and the authoritative remaining
  // balance returned by each POST /orders/:id/payments.
  const [split, setSplit] = useState<{
    orderId: string;
    label: string;
    remaining: number; // cents
    made: { method: string; applied: number; changeGiven: number | null }[];
  } | null>(null);
  const [splitAmount, setSplitAmount] = useState<number | null>(null); // dollars
  const [splitCashMode, setSplitCashMode] = useState(false);
  const [splitCashReceived, setSplitCashReceived] = useState<number | null>(
    null,
  );
  const [splitBusy, setSplitBusy] = useState(false);

  // Unpaid orders (AI phone orders awaiting in-store payment, held orders, ...)
  const [openOrders, setOpenOrders] = useState<OpenOrderRow[]>([]);
  const [ordersDrawerOpen, setOrdersDrawerOpen] = useState(false);

  // Loaded existing order (AI voice handoff / edit mode)
  const [editingOrder, setEditingOrder] = useState<ExistingOrder | null>(null);

  // Modifier picker state; editingLineKey means "replace that cart line" on confirm.
  // Selections are arrays per group: single-select groups hold at most one id,
  // multi-select groups hold up to maxSelections ids.
  const [pickerItem, setPickerItem] = useState<MenuItem | null>(null);
  const [pickerSelections, setPickerSelections] = useState<
    Record<string, string[]>
  >({});
  const [pickerNotes, setPickerNotes] = useState("");
  const [pickerCourse, setPickerCourse] = useState<number | undefined>(undefined);
  const [editingLineKey, setEditingLineKey] = useState<string | null>(null);

  const loadFloorPlans = () => {
    if (!selectedLocationId) return;
    api
      .get(`/tables/locations/${selectedLocationId}/floor-plans`)
      .then(({ data }) => {
        setFloorPlans(data ?? []);
      })
      .catch((e) => console.error(e));
  };

  useEffect(() => {
    if (viewMode === "floor_plan") {
      loadFloorPlans();
      const timer = setInterval(loadFloorPlans, 10000);
      return () => clearInterval(timer);
    }
  }, [viewMode, selectedLocationId]);

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

  const loadOpenOrders = () => {
    if (!selectedLocationId) return;
    api
      .get<{ data: OpenOrderRow[] }>(
        `/orders?locationId=${selectedLocationId}&limit=50`,
      )
      .then(({ data }) => {
        const rows = (data.data ?? []).filter(
          (o) => !o.paidAt && ["pending", "confirmed"].includes(o.status),
        );
        setOpenOrders(rows);
      })
      .catch(() => {
        // Non-critical — the badge just stays stale.
      });
  };

  useEffect(() => {
    if (!selectedLocationId) return;
    loadOpenOrders();
    // Refresh the open-orders badge when a new order lands (AI phone orders
    // arrive via the realtime channel elsewhere; polling keeps this simple).
    const timer = setInterval(loadOpenOrders, 30000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLocationId]);

  useEffect(() => {
    let cancelled = false;
    api
      .get<Discount[]>("/discounts")
      .then(({ data }) => {
        if (!cancelled) setDiscounts(data ?? []);
      })
      .catch(() => {
        // Discounts are optional — the register works without them.
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
        setAppliedDiscountId(data.discountId ?? null);
        if (data.tipAmount) {
          setTipPct(-1);
          setCustomTip(data.tipAmount / 100);
        }
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
  // Discount reduces the taxable base; tip (on the discounted subtotal) is added after tax.
  const appliedDiscount =
    discounts.find((d) => d.id === appliedDiscountId) ?? null;
  const discountAmount = appliedDiscount
    ? Math.min(
        subtotal,
        appliedDiscount.type === "percent"
          ? Math.round((subtotal * appliedDiscount.value) / 100)
          : appliedDiscount.value,
      )
    : 0;
  const taxableBase = subtotal - discountAmount;
  const taxRateBps = selectedLocation?.taxRateBps ?? 0;
  const taxAmount = Math.round((taxableBase * taxRateBps) / 10000);
  const tipAmount =
    tipPct === -1
      ? Math.max(0, Math.round(customTip * 100))
      : Math.round((taxableBase * tipPct) / 100);
  const total = taxableBase + taxAmount + tipAmount;

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
    setAppliedDiscountId(null);
    setTipPct(0);
    setCustomTip(0);
    setPromoInput("");
    setTenderOpen(false);
    setShowCustomer(false);
    setShowNote(false);
    setPayStep("select");
    setCashReceived(null);
    setSplit(null);
    setSplitAmount(null);
    setSplitCashMode(false);
    setSplitCashReceived(null);
  };

  const buildLine = (
    item: MenuItem,
    options: CartOption[],
    notes?: string,
    course?: number,
  ): CartLine => {
    const optsPrice = options.reduce((sum, o) => sum + o.priceAdjustment, 0);
    return {
      key: `${item.id}-${Date.now()}`,
      menuItemId: item.id,
      name: item.name,
      unitPrice: item.price + optsPrice,
      quantity: 1,
      options,
      notes,
      course,
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
    selections: Record<string, string[]>,
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
    const selections: Record<string, string[]> = {};
    for (const group of item.modifiers ?? []) {
      const chosen = line.options
        .filter((o) => group.options.some((go) => go.id === o.id))
        .map((o) => o.id);
      if (chosen.length > 0) selections[group.id] = chosen;
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
      const picked = pickerSelections[g.id] ?? [];
      if (g.isRequired && picked.length === 0) {
        message.warning(`Please choose a ${g.name}.`);
        return;
      }
      if (g.multiSelect && g.maxSelections != null && picked.length > g.maxSelections) {
        message.warning(`${g.name}: choose at most ${g.maxSelections}.`);
        return;
      }
    }
    const options: CartOption[] = [];
    for (const g of groups) {
      for (const optId of pickerSelections[g.id] ?? []) {
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
    }
    const notes = pickerNotes.trim() || undefined;
    const course = pickerCourse;
    if (editingLineKey) {
      const replacement = buildLine(pickerItem, options, notes, course);
      setCart((prev) =>
        prev.map((l) =>
          l.key === editingLineKey
            ? { ...replacement, key: l.key, quantity: l.quantity }
            : l,
        ),
      );
    } else {
      setCart((prev) => [...prev, buildLine(pickerItem, options, notes, course)]);
    }
    setPickerItem(null);
    setPickerCourse(undefined);
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

  const applyPromo = () => {
    const code = promoInput.trim().toUpperCase();
    if (!code) return;
    const match = discounts.find((d) => d.code?.toUpperCase() === code);
    if (!match) {
      message.error(`Promo code "${code}" not found.`);
      return;
    }
    if (match.requiresManager && !canApplyManagerDiscounts) {
      message.warning(`"${match.name}" requires a manager to apply.`);
      return;
    }
    setAppliedDiscountId(match.id);
    setPromoInput("");
    setDiscountModalOpen(false);
    message.success(`${match.name} applied.`);
  };

  const cartPayloadItems = () =>
    cart.map((l) => ({
      menuItemId: l.menuItemId,
      quantity: l.quantity,
      optionIds: l.options.map((o) => o.id).filter(Boolean),
      notes: l.notes,
      course: l.course,
    }));

  /**
   * Save without paying: new carts become unpaid orders (kitchen fires, receipt
   * waits), edited orders get their changes persisted. Either way the register
   * clears and the order waits in Open Orders until it's charged.
   */
  const saveOrder = async () => {
    if (!selectedLocationId || cart.length === 0) return;
    setSaving(true);
    try {
      if (editingOrder) {
        await api.put(`/orders/${editingOrder.id}/items`, {
          customerName: customerName.trim() || undefined,
          orderType,
          specialInstructions: orderNotes.trim() || undefined,
          discountId: appliedDiscountId ?? undefined,
          items: cartPayloadItems(),
        });
        message.success(
          `Order ${orderLabel(editingOrder)} updated — corrected ticket sent to kitchen.`,
          5,
        );
      } else {
        const res = await api.post<{ ticketNumber?: number | null; id: string }>(
          "/orders/pos",
          {
            locationId: selectedLocationId,
            orderType,
            customerName: customerName.trim() || undefined,
            specialInstructions: orderNotes.trim() || undefined,
            discountId: appliedDiscountId ?? undefined,
            items: cartPayloadItems(),
          },
        );
        message.success(
          `Order ${orderLabel(res.data)} saved — kitchen ticket sent. Charge it later from Open Orders.`,
          5,
        );
      }
      resetRegister();
      loadOpenOrders();
      if (editingOrder) router.replace("/pos");
    } catch {
      message.error("Failed to save the order.");
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
          discountId: appliedDiscountId ?? undefined,
          items: cartPayloadItems(),
        });
        const res = await api.post<typeof paid>(
          `/orders/${editingOrder.id}/pay`,
          { paymentMethod: method, tipAmount },
        );
        paid = res.data;
      } else {
        const res = await api.post<typeof paid>("/orders/pos", {
          locationId: selectedLocationId,
          orderType,
          paymentMethod: method,
          customerName: customerName.trim() || undefined,
          specialInstructions: orderNotes.trim() || undefined,
          discountId: appliedDiscountId ?? undefined,
          tipAmount,
          items: cartPayloadItems(),
        });
        paid = res.data;
      }
      message.success(
        `Order ${orderLabel(paid)} paid with ${method} — ${fmtMoney(paid.totalAmount)}. Ticket sent to kitchen.`,
        5,
      );
      resetRegister();
      loadOpenOrders();
      if (editingOrder) router.replace("/pos");
    } catch {
      message.error("Failed to place the order. Nothing was charged.");
    } finally {
      setCharging(null);
    }
  };

  /**
   * Enter split mode: the cart must exist as a real (unpaid) order first so
   * partial payments have something to attach to. New carts are created unpaid;
   * an order being edited gets its changes persisted.
   */
  const startSplit = async () => {
    if (!selectedLocationId || cart.length === 0) return;
    setSplitBusy(true);
    try {
      let orderRow: { id: string; ticketNumber?: number | null; totalAmount: number };
      if (editingOrder) {
        const res = await api.put<typeof orderRow>(
          `/orders/${editingOrder.id}/items`,
          {
            customerName: customerName.trim() || undefined,
            orderType,
            specialInstructions: orderNotes.trim() || undefined,
            discountId: appliedDiscountId ?? undefined,
            items: cartPayloadItems(),
          },
        );
        orderRow = res.data;
      } else {
        const res = await api.post<typeof orderRow>("/orders/pos", {
          locationId: selectedLocationId,
          orderType,
          customerName: customerName.trim() || undefined,
          specialInstructions: orderNotes.trim() || undefined,
          discountId: appliedDiscountId ?? undefined,
          items: cartPayloadItems(),
        });
        orderRow = res.data;
      }
      // The tip chosen in the tender modal rides on the first split payment.
      const startingRemaining = orderRow.totalAmount + tipAmount;
      setSplit({
        orderId: orderRow.id,
        label: orderLabel(orderRow),
        remaining: startingRemaining,
        made: [],
      });
      setSplitAmount(Math.ceil(startingRemaining / 2) / 100);
      setPayStep("split");
    } catch {
      message.error("Failed to start the split.");
    } finally {
      setSplitBusy(false);
    }
  };

  const paySplitPortion = async (method: "cash" | "card") => {
    if (!split || splitAmount == null) return;
    const amountCents = Math.min(
      Math.round(splitAmount * 100),
      split.remaining,
    );
    if (amountCents <= 0) return;
    setSplitBusy(true);
    try {
      const res = await api.post<{
        applied: number;
        changeGiven: number | null;
        remaining: number;
        paid: boolean;
      }>(`/orders/${split.orderId}/payments`, {
        method,
        amount: amountCents,
        // Tip is carried once, by the first payment.
        tipAmount: split.made.length === 0 && tipAmount > 0 ? tipAmount : undefined,
        cashReceived:
          method === "cash" && splitCashReceived != null
            ? Math.round(splitCashReceived * 100)
            : undefined,
      });
      if ((res.data.changeGiven ?? 0) > 0) {
        message.info(`Change due: ${fmtMoney(res.data.changeGiven!)}`, 6);
      }
      if (res.data.paid) {
        message.success(`Order ${split.label} fully paid. Ticket complete.`, 5);
        resetRegister();
        loadOpenOrders();
        if (editingOrder) router.replace("/pos");
        return;
      }
      setSplit({
        ...split,
        remaining: res.data.remaining,
        made: [
          ...split.made,
          {
            method,
            applied: res.data.applied,
            changeGiven: res.data.changeGiven,
          },
        ],
      });
      setSplitAmount(res.data.remaining / 100);
      setSplitCashMode(false);
      setSplitCashReceived(null);
    } catch {
      message.error("Payment failed — nothing was recorded.");
    } finally {
      setSplitBusy(false);
    }
  };

  /** Closing the tender modal mid-split: the order exists (possibly partially
   * paid) — park it in Open Orders rather than leaving the register ambiguous. */
  const closeTender = () => {
    if (split) {
      message.info(
        `Order ${split.label} saved${split.made.length ? " (partially paid)" : ""} — finish from Open Orders.`,
        6,
      );
      resetRegister();
      loadOpenOrders();
      if (editingOrder) router.replace("/pos");
      return;
    }
    setTenderOpen(false);
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
        actions={
          <Radio.Group
            value={viewMode}
            onChange={(e) => setViewMode(e.target.value as "menu" | "floor_plan")}
            buttonStyle="solid"
            aria-label="Register view"
          >
            <Radio.Button value="menu">Menu</Radio.Button>
            <Radio.Button value="floor_plan">Floor Plan</Radio.Button>
          </Radio.Group>
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

      {/* Height, wrapping, and touch behavior live in globals.css (.pos-*) so they
          can respond to iPad/tablet breakpoints; colors stay tokenized inline. */}
      <div className="pos-register" style={{ gap: token.marginSM }}>
        {/* Items area / Floor plan area */}
        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            gap: token.marginSM,
          }}
        >
          {viewMode === "menu" ? (
            <>
              <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                <Input
              allowClear
              prefix={<SearchOutlined />}
              placeholder="Search menu..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search menu"
              style={{ flex: 1, maxWidth: 420 }}
            />
            <Badge count={openOrders.length} size="small" offset={[-4, 2]}>
              <Button
                icon={<ClockCircleOutlined />}
                onClick={() => {
                  loadOpenOrders();
                  setOrdersDrawerOpen(true);
                }}
                aria-label="View open orders"
              >
                Open Orders
              </Button>
            </Badge>
          </div>

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
                className="pos-pill-strip pos-scroll"
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
          <div
            className="pos-scroll"
            style={{ flex: 1, minHeight: 0, overflowY: "auto" }}
          >
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
                className="pos-item-grid"
                style={{ gap: token.marginSM }}
              >
                {visibleItems.map((item) => (
                  <div
                    key={item.id}
                    className="pos-tile"
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
                      minHeight: 92,
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "flex-start",
                      gap: 6,
                      overflow: "hidden",
                      transition:
                        "border-color 0.15s, box-shadow 0.15s, transform 0.15s",
                    }}
                    onMouseEnter={(e) => {
                      if (!item.isAvailable) return;
                      e.currentTarget.style.borderColor = token.colorPrimary;
                      e.currentTarget.style.boxShadow = token.boxShadowSecondary;
                      e.currentTarget.style.transform = "translateY(-2px)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor =
                        token.colorBorderSecondary;
                      e.currentTarget.style.boxShadow = "none";
                      e.currentTarget.style.transform = "none";
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 4,
                        minWidth: 0,
                      }}
                    >
                      {item.isFavorite && (
                        <StarFilled
                          style={{
                            color: token.colorWarning,
                            fontSize: 12,
                            flexShrink: 0,
                            marginTop: 4,
                          }}
                        />
                      )}
                      {/* Full name always visible — wraps to the next line */}
                      <Text
                        strong
                        style={{
                          fontSize: 14,
                          lineHeight: 1.35,
                          flex: 1,
                          minWidth: 0,
                          overflowWrap: "break-word",
                        }}
                      >
                        {item.name}
                      </Text>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        marginTop: "auto",
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
            </>
          ) : (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 16, overflowY: "auto" }}>
              {floorPlans.length === 0 ? (
                <Empty description="No floor plans available." />
              ) : (
                floorPlans.map((fp) => (
                  <div key={fp.id} style={{ border: `1px solid ${token.colorBorderSecondary}`, borderRadius: token.borderRadiusLG, padding: token.padding }}>
                    <Text strong style={{ fontSize: 18, marginBottom: 16, display: "block" }}>{fp.name}</Text>
                    <div style={{ position: "relative", width: "100%", height: 400, background: token.colorFillAlter, borderRadius: token.borderRadius }}>
                      {fp.tables?.map((table) => {
                        const isSelected = selectedTableId === table.id;
                        let bgColor = token.colorBgContainer;
                        if (table.status === 'occupied') bgColor = token.colorWarningBg;
                        else if (table.status === 'billed') bgColor = token.colorSuccessBg;
                        
                        return (
                          <div
                            key={table.id}
                            onClick={() => setSelectedTableId(isSelected ? null : table.id)}
                            style={{
                              position: "absolute",
                              left: `${table.posX}%`,
                              top: `${table.posY}%`,
                              width: 80,
                              height: table.shape === 'circle' ? 80 : 60,
                              borderRadius: table.shape === 'circle' ? '50%' : token.borderRadius,
                              background: bgColor,
                              border: `2px solid ${isSelected ? token.colorPrimary : token.colorBorder}`,
                              display: "flex",
                              flexDirection: "column",
                              alignItems: "center",
                              justifyContent: "center",
                              cursor: "pointer",
                              boxShadow: token.boxShadowTertiary,
                              transform: "translate(-50%, -50%)",
                              transition: "all 0.2s"
                            }}
                          >
                            <Text strong>{table.name}</Text>
                            <Text type="secondary" style={{ fontSize: 10 }}>
                              {table.capacity} pax
                            </Text>
                            {(table.activeOrderTotal ?? 0) > 0 && (
                              <Text type="success" style={{ fontSize: 12, marginTop: 4 }}>
                                {fmtMoney(table.activeOrderTotal ?? 0)}
                              </Text>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* Cart panel — width is fluid on tablets (globals.css .pos-cart) */}
        <div
          className="pos-cart"
          style={{
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
          {/* Customer + note are one-tap reveals — hidden until needed (Square pattern) */}
          {showCustomer || customerName ? (
            <Input
              placeholder="Customer name"
              value={customerName}
              autoFocus={showCustomer && !customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              aria-label="Customer name"
              allowClear
              style={{ marginBottom: token.marginXS }}
            />
          ) : null}

          <div
            className="pos-scroll"
            style={{ flex: 1, minHeight: 0, overflowY: "auto" }}
          >
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

          {/* Quick reveals — kept out of the way until needed */}
          <Space size={4} style={{ marginBottom: token.marginXS }}>
            {!showCustomer && !customerName && (
              <Button
                size="small"
                type="text"
                icon={<UserOutlined />}
                onClick={() => setShowCustomer(true)}
                aria-label="Add customer name"
              >
                Customer
              </Button>
            )}
            {!showNote && !orderNotes && (
              <Button
                size="small"
                type="text"
                icon={<EditOutlined />}
                onClick={() => setShowNote(true)}
                aria-label="Add order note"
              >
                Note
              </Button>
            )}
            {appliedDiscount && (
              <Tag
                color="green"
                closable
                onClose={() => setAppliedDiscountId(null)}
                style={{ margin: 0 }}
              >
                {appliedDiscount.name} −{fmtMoney(discountAmount)}
              </Tag>
            )}
          </Space>
          {(showNote || orderNotes) && (
            <Input.TextArea
              rows={2}
              placeholder="Order note — e.g. allergy, rush"
              value={orderNotes}
              autoFocus={showNote && !orderNotes}
              onChange={(e) => setOrderNotes(e.target.value)}
              maxLength={1000}
              aria-label="Order instructions"
              style={{ marginBottom: token.marginXS }}
            />
          )}

          {cart.length > 0 && (
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginBottom: 2,
              }}
            >
              <Text type="secondary" style={{ fontSize: 13 }}>
                Subtotal{" "}
                {taxRateBps > 0 &&
                  `· Tax ${(taxRateBps / 100).toFixed(2)}%`}
                {tipAmount > 0 && ` · Tip ${fmtMoney(tipAmount)}`}
              </Text>
              <Text type="secondary" style={{ fontSize: 13 }}>
                {fmtMoney(subtotal)}
              </Text>
            </div>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <Button
              type="primary"
              size="large"
              disabled={cart.length === 0 || saving}
              onClick={() => {
                setPayStep("select");
                setCashReceived(null);
                setTenderOpen(true);
              }}
              aria-label={`Charge ${fmtMoney(total)}`}
              style={{ flex: 1, height: 60, fontSize: 18, fontWeight: 600 }}
            >
              Charge {cart.length > 0 ? fmtMoney(total) : ""}
            </Button>
            <Tooltip title="Save for later — pay from Open Orders">
              <Button
                size="large"
                icon={<SaveOutlined />}
                disabled={cart.length === 0 || charging !== null}
                loading={saving}
                onClick={saveOrder}
                aria-label="Save order without payment"
                style={{ height: 60, width: 64 }}
              />
            </Tooltip>
          </div>
        </div>
      </div>

      {/* Open orders — unpaid tickets (AI phone orders awaiting payment, holds) */}
      <Drawer
        title={`Open Orders (${openOrders.length})`}
        placement="right"
        open={ordersDrawerOpen}
        onClose={() => setOrdersDrawerOpen(false)}
      >
        {openOrders.length === 0 ? (
          <Empty description="No unpaid orders. New AI phone orders appear here." />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {openOrders.map((o) => (
              <div
                key={o.id}
                role="button"
                tabIndex={0}
                aria-label={`Open order ${orderLabel(o)}`}
                onClick={() => {
                  setOrdersDrawerOpen(false);
                  router.push(`/pos?orderId=${o.id}`);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    setOrdersDrawerOpen(false);
                    router.push(`/pos?orderId=${o.id}`);
                  }
                }}
                style={{
                  border: `1px solid ${token.colorBorderSecondary}`,
                  borderRadius: token.borderRadiusLG,
                  padding: token.paddingSM,
                  cursor: "pointer",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <Space size={6}>
                    <Text strong>{orderLabel(o)}</Text>
                    {o.source === "ai_phone" ? (
                      <Tag color="blue" style={{ margin: 0 }}>
                        AI Phone
                      </Tag>
                    ) : (
                      <Tag style={{ margin: 0 }}>POS</Tag>
                    )}
                  </Space>
                  <Text strong>{fmtMoney(o.totalAmount)}</Text>
                </div>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    marginTop: 4,
                  }}
                >
                  <Text type="secondary" style={{ fontSize: 13 }}>
                    {o.customerName}
                    {o.customerPhone ? ` · ${o.customerPhone}` : ""}
                  </Text>
                  <Text type="secondary" style={{ fontSize: 13 }}>
                    {new Date(o.createdAt).toLocaleTimeString([], {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </Text>
                </div>
              </div>
            ))}
          </div>
        )}
      </Drawer>

      {/* Tender step — total, tip, discount, then payment (Square/Toast flow) */}
      <Modal
        open={tenderOpen}
        title={null}
        onCancel={closeTender}
        footer={null}
        destroyOnHidden
        width={420}
      >
        <div style={{ textAlign: "center", padding: "8px 0 4px" }}>
          <Text type="secondary">
            {payStep === "split" && split
              ? `Order ${split.label} — remaining`
              : editingOrder
                ? `Order ${orderLabel(editingOrder)}`
                : "Total due"}
          </Text>
          <Title level={1} style={{ margin: "0 0 4px", fontVariantNumeric: "tabular-nums" }}>
            {payStep === "split" && split
              ? fmtMoney(split.remaining)
              : fmtMoney(total)}
          </Title>
          {payStep !== "split" && (
            <Text type="secondary" style={{ fontSize: 13 }}>
              Subtotal {fmtMoney(subtotal)}
              {discountAmount > 0 && ` − discount ${fmtMoney(discountAmount)}`}
              {" + tax "}
              {fmtMoney(taxAmount)}
              {tipAmount > 0 && ` + tip ${fmtMoney(tipAmount)}`}
            </Text>
          )}
        </div>

        <Divider style={{ margin: "12px 0" }} />

        {payStep !== "split" && (
          <>
            <Text strong style={{ display: "block", marginBottom: 6 }}>
              Tip
            </Text>
            <Segmented
              block
              value={tipPct}
              onChange={(v) => setTipPct(v as number)}
              options={[
                { label: "None", value: 0 },
                { label: "10%", value: 10 },
                { label: "15%", value: 15 },
                { label: "20%", value: 20 },
                { label: "Custom", value: -1 },
              ]}
            />
            {tipPct === -1 && (
              <InputNumber
                min={0}
                step={0.25}
                precision={2}
                prefix="$"
                value={customTip}
                onChange={(v) => setCustomTip(v ?? 0)}
                aria-label="Custom tip amount"
                style={{ width: "100%", marginTop: 8 }}
              />
            )}

            <div style={{ marginTop: 12 }}>
              {appliedDiscount ? (
                <Tag
                  color="green"
                  closable
                  onClose={() => setAppliedDiscountId(null)}
                >
                  {appliedDiscount.name} −{fmtMoney(discountAmount)}
                </Tag>
              ) : (
                <Button
                  size="small"
                  type="dashed"
                  icon={<TagOutlined />}
                  onClick={() => setDiscountModalOpen(true)}
                  aria-label="Add discount"
                >
                  Add discount
                </Button>
              )}
            </div>

            <Divider style={{ margin: "12px 0" }} />
          </>
        )}

        {payStep === "select" ? (
          <>
            <Space.Compact block>
              <Button
                type="primary"
                size="large"
                icon={<DollarOutlined />}
                disabled={charging !== null || splitBusy}
                onClick={() => {
                  setCashReceived(null);
                  setPayStep("cash");
                }}
                aria-label="Pay with cash"
                style={{ flex: 1, height: 60, fontSize: 16 }}
              >
                Cash
              </Button>
              <Button
                type="primary"
                size="large"
                icon={<CreditCardOutlined />}
                disabled={charging !== null || splitBusy}
                loading={charging === "card"}
                onClick={() => charge("card")}
                aria-label="Pay with card"
                style={{ flex: 1, height: 60, fontSize: 16 }}
              >
                Card
              </Button>
            </Space.Compact>
            <Button
              block
              size="large"
              disabled={charging !== null}
              loading={splitBusy}
              onClick={startSplit}
              aria-label="Split the payment"
              style={{ marginTop: 8, height: 44 }}
            >
              Split payment…
            </Button>
          </>
        ) : payStep === "split" && split ? (
          <>
            {split.made.length > 0 && (
              <div style={{ marginBottom: 8 }}>
                {split.made.map((p, i) => (
                  <div
                    key={i}
                    style={{ display: "flex", justifyContent: "space-between" }}
                  >
                    <Text type="secondary" style={{ fontSize: 13 }}>
                      Payment {i + 1} — {p.method}
                      {p.changeGiven ? ` (change ${fmtMoney(p.changeGiven)})` : ""}
                    </Text>
                    <Text type="secondary" style={{ fontSize: 13 }}>
                      {fmtMoney(p.applied)}
                    </Text>
                  </div>
                ))}
              </div>
            )}

            {!splitCashMode ? (
              <>
                <Text strong style={{ display: "block", marginBottom: 6 }}>
                  This payment
                </Text>
                <Space wrap style={{ marginBottom: 8 }}>
                  {[2, 3, 4].map((n) => (
                    <Button
                      key={n}
                      size="small"
                      onClick={() =>
                        setSplitAmount(Math.ceil(split.remaining / n) / 100)
                      }
                    >
                      ÷{n} ({fmtMoney(Math.ceil(split.remaining / n))})
                    </Button>
                  ))}
                  <Button
                    size="small"
                    onClick={() => setSplitAmount(split.remaining / 100)}
                  >
                    Rest ({fmtMoney(split.remaining)})
                  </Button>
                </Space>
                <InputNumber
                  min={0.01}
                  max={split.remaining / 100}
                  step={1}
                  precision={2}
                  prefix="$"
                  value={splitAmount}
                  onChange={(v) => setSplitAmount(v)}
                  aria-label="Split payment amount"
                  size="large"
                  style={{ width: "100%", marginBottom: 12 }}
                />
                <Space.Compact block>
                  <Button
                    size="large"
                    icon={<DollarOutlined />}
                    disabled={splitBusy || !splitAmount}
                    onClick={() => {
                      setSplitCashReceived(splitAmount);
                      setSplitCashMode(true);
                    }}
                    aria-label="Pay this portion with cash"
                    style={{ flex: 1, height: 56 }}
                  >
                    Cash
                  </Button>
                  <Button
                    type="primary"
                    size="large"
                    icon={<CreditCardOutlined />}
                    disabled={splitBusy || !splitAmount}
                    loading={splitBusy}
                    onClick={() => paySplitPortion("card")}
                    aria-label="Pay this portion with card"
                    style={{ flex: 1, height: 56 }}
                  >
                    Card
                  </Button>
                </Space.Compact>
              </>
            ) : (
              <>
                <Text strong style={{ display: "block", marginBottom: 6 }}>
                  Cash received for {fmtMoney(Math.round((splitAmount ?? 0) * 100))}
                </Text>
                <InputNumber
                  min={0}
                  step={1}
                  precision={2}
                  prefix="$"
                  value={splitCashReceived}
                  onChange={(v) => setSplitCashReceived(v)}
                  aria-label="Cash received for this portion"
                  size="large"
                  style={{ width: "100%", marginBottom: 8 }}
                />
                {splitCashReceived != null && splitAmount != null && (
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      padding: "8px 12px",
                      borderRadius: token.borderRadiusLG,
                      background:
                        splitCashReceived >= splitAmount
                          ? token.colorSuccessBg
                          : token.colorErrorBg,
                      marginBottom: 12,
                    }}
                  >
                    <Text strong>
                      {splitCashReceived >= splitAmount
                        ? "Change due"
                        : "Still owed"}
                    </Text>
                    <Text strong style={{ fontSize: 18 }}>
                      {fmtMoney(
                        Math.abs(
                          Math.round((splitCashReceived - splitAmount) * 100),
                        ),
                      )}
                    </Text>
                  </div>
                )}
                <Space.Compact block>
                  <Button
                    size="large"
                    onClick={() => setSplitCashMode(false)}
                    aria-label="Back to split amount"
                    style={{ height: 56 }}
                  >
                    Back
                  </Button>
                  <Button
                    type="primary"
                    size="large"
                    icon={<DollarOutlined />}
                    disabled={
                      splitBusy ||
                      splitCashReceived == null ||
                      splitAmount == null ||
                      splitCashReceived < splitAmount
                    }
                    loading={splitBusy}
                    onClick={() => paySplitPortion("cash")}
                    aria-label="Confirm cash portion"
                    style={{ flex: 1, height: 56 }}
                  >
                    Confirm Cash
                  </Button>
                </Space.Compact>
              </>
            )}
          </>
        ) : (
          <>
            {/* Cash tendered → change due */}
            <Text strong style={{ display: "block", marginBottom: 6 }}>
              Cash received
            </Text>
            <Space wrap style={{ marginBottom: 8 }}>
              <Button onClick={() => setCashReceived(total / 100)}>
                Exact {fmtMoney(total)}
              </Button>
              {[20, 50, 100]
                .filter((bill) => bill * 100 >= total)
                .map((bill) => (
                  <Button key={bill} onClick={() => setCashReceived(bill)}>
                    ${bill}
                  </Button>
                ))}
            </Space>
            <InputNumber
              min={0}
              step={1}
              precision={2}
              prefix="$"
              value={cashReceived}
              onChange={(v) => setCashReceived(v)}
              placeholder="Amount from customer"
              aria-label="Cash received"
              size="large"
              style={{ width: "100%", marginBottom: 8 }}
            />
            {cashReceived != null && (
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  padding: "8px 12px",
                  borderRadius: token.borderRadiusLG,
                  background:
                    Math.round(cashReceived * 100) >= total
                      ? token.colorSuccessBg
                      : token.colorErrorBg,
                  marginBottom: 12,
                }}
              >
                <Text strong>
                  {Math.round(cashReceived * 100) >= total
                    ? "Change due"
                    : "Still owed"}
                </Text>
                <Text
                  strong
                  style={{ fontSize: 18, fontVariantNumeric: "tabular-nums" }}
                >
                  {fmtMoney(Math.abs(Math.round(cashReceived * 100) - total))}
                </Text>
              </div>
            )}
            <Space.Compact block>
              <Button
                size="large"
                onClick={() => setPayStep("select")}
                aria-label="Back to payment methods"
                style={{ height: 56 }}
              >
                Back
              </Button>
              <Button
                type="primary"
                size="large"
                icon={<DollarOutlined />}
                disabled={
                  charging !== null ||
                  cashReceived == null ||
                  Math.round(cashReceived * 100) < total
                }
                loading={charging === "cash"}
                onClick={() => charge("cash")}
                aria-label="Complete cash payment"
                style={{ flex: 1, height: 56, fontSize: 16 }}
              >
                Complete Cash Payment
              </Button>
            </Space.Compact>
          </>
        )}
      </Modal>

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
        {(pickerItem?.modifiers ?? []).map((group) => {
          const picked = pickerSelections[group.id] ?? [];
          const atCap =
            group.multiSelect &&
            group.maxSelections != null &&
            picked.length >= group.maxSelections;
          const optionLabel = (opt: ModifierOption) => (
            <>
              {opt.name}
              {opt.priceAdjustment !== 0 && (
                <Text type="secondary"> (+{fmtMoney(opt.priceAdjustment)})</Text>
              )}
            </>
          );
          return (
            <div key={group.id} style={{ marginBottom: token.margin }}>
              <Text strong>
                {group.name}{" "}
                {group.isRequired ? (
                  <Tag color="red">required</Tag>
                ) : (
                  <Tag>optional</Tag>
                )}
                {group.multiSelect && (
                  <Tag color="blue">
                    {group.maxSelections != null
                      ? `choose up to ${group.maxSelections}`
                      : "choose any"}
                  </Tag>
                )}
              </Text>
              {group.multiSelect ? (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                    marginTop: 6,
                  }}
                >
                  {group.options.map((opt) => (
                    <Checkbox
                      key={opt.id}
                      checked={picked.includes(opt.id)}
                      // Cap enforcement: once at maxSelections, only unchecking is allowed.
                      disabled={atCap ? !picked.includes(opt.id) : false}
                      onChange={(e) =>
                        setPickerSelections((prev) => ({
                          ...prev,
                          [group.id]: e.target.checked
                            ? [...picked, opt.id]
                            : picked.filter((id) => id !== opt.id),
                        }))
                      }
                    >
                      {optionLabel(opt)}
                    </Checkbox>
                  ))}
                </div>
              ) : (
                <Radio.Group
                  value={picked[0]}
                  onChange={(e) =>
                    setPickerSelections((prev) => ({
                      ...prev,
                      [group.id]:
                        e.target.value == null ? [] : [e.target.value as string],
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
                      {optionLabel(opt)}
                    </Radio>
                  ))}
                </Radio.Group>
              )}
            </div>
          );
        })}
        <Input.TextArea
          rows={2}
          placeholder="Kitchen note (optional)"
          value={pickerNotes}
          onChange={(e) => setPickerNotes(e.target.value)}
          maxLength={500}
          aria-label="Kitchen note"
          style={{ marginBottom: token.margin }}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Text strong>Course</Text>
          <Radio.Group value={pickerCourse} onChange={(e) => setPickerCourse(e.target.value)}>
            <Radio.Button value={undefined}>None</Radio.Button>
            <Radio.Button value={1}>1 (Appetizer)</Radio.Button>
            <Radio.Button value={2}>2 (Main)</Radio.Button>
            <Radio.Button value={3}>3 (Dessert)</Radio.Button>
          </Radio.Group>
        </div>
      </Modal>

      {/* Discount picker */}
      <Modal
        open={discountModalOpen}
        title="Apply Discount"
        onCancel={() => setDiscountModalOpen(false)}
        footer={null}
        destroyOnHidden
      >
        <Space.Compact block style={{ marginBottom: token.margin }}>
          <Input
            placeholder="Promo code"
            value={promoInput}
            onChange={(e) => setPromoInput(e.target.value)}
            onPressEnter={() => applyPromo()}
            aria-label="Promo code"
          />
          <Button type="primary" onClick={() => applyPromo()}>
            Apply
          </Button>
        </Space.Compact>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {discounts.length === 0 && (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="No discounts configured. Add them in Store Settings."
            />
          )}
          {discounts.map((d) => {
            const locked = d.requiresManager && !canApplyManagerDiscounts;
            return (
              <Button
                key={d.id}
                block
                disabled={locked}
                onClick={() => {
                  setAppliedDiscountId(d.id);
                  setDiscountModalOpen(false);
                }}
                aria-label={`Apply ${d.name}`}
                style={{
                  height: 44,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <span>
                  {d.name}
                  {d.requiresManager && (
                    <Tag color="orange" style={{ marginLeft: 8 }}>
                      manager
                    </Tag>
                  )}
                </span>
                <Text type="secondary">
                  {d.type === "percent"
                    ? `${d.value}% off`
                    : `${fmtMoney(d.value)} off`}
                </Text>
              </Button>
            );
          })}
        </div>
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
