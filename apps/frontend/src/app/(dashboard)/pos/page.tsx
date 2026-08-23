"use client";

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Alert, App, Button, Radio, Skeleton, Typography, theme } from "antd";
import { api } from "@/lib/api";
import { useLocation } from "@/contexts/LocationContext";
import { EmptyState, ErrorState } from "@/components/PageStates";
import TransactionDrawer from "@/components/TransactionDrawer";
import TransactionsListDrawer, {
  type TxOrder,
} from "@/components/TransactionsListDrawer";
import MenuPanel from "./components/MenuPanel";
import FloorPlanView from "./components/FloorPlanView";
import CartPanel from "./components/CartPanel";
import TenderModal, { type PersistedOrder } from "./components/TenderModal";
import ModifierPickerModal from "./components/ModifierPickerModal";
import DiscountModal from "./components/DiscountModal";
import ManagerPinModal from "./components/ManagerPinModal";
import { buildLine, cartReducer } from "./cart";
import { fmtMoney, orderLabel } from "./types";
import type {
  CartLine,
  CartOption,
  Category,
  CustomerRow,
  ExistingOrder,
  FloorPlan,
  MenuItem,
  OpenOrderRow,
} from "./types";

const { Title } = Typography;

function PosRegister() {
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const router = useRouter();
  const searchParams = useSearchParams();
  const editOrderId = searchParams.get("orderId");
  const duplicateOrderId = searchParams.get("duplicateOrder");
  const duplicatedRef = useRef(false);
  const { selectedLocationId, selectedLocation, userRole } = useLocation();
  // Manager-only discounts are role-gated until PIN-based user switching lands.
  const canApplyManagerDiscounts = userRole !== "user";

  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [cart, dispatchCart] = useReducer(cartReducer, []);
  const [orderType, setOrderType] = useState<string>("dine_in");

  // Floor plan / Table management
  const [viewMode, setViewMode] = useState<"menu" | "floor_plan">("menu");
  const [floorPlans, setFloorPlans] = useState<FloorPlan[]>([]);
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);

  const [customerName, setCustomerName] = useState("");
  // Linked customer profile (search-as-you-type); free-typed names stay unlinked.
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [customerResults, setCustomerResults] = useState<CustomerRow[]>([]);
  const [reordering, setReordering] = useState(false);
  const [orderNotes, setOrderNotes] = useState("");
  const [charging, setCharging] = useState<"cash" | "card" | null>(null);
  const [saving, setSaving] = useState(false);

  // Tender extras: discounts (fetched once) and tip selection.
  const [discounts, setDiscounts] = useState<
    { id: string; name: string; code?: string | null; type: string; value: number; requiresManager: boolean }[]
  >([]);
  const [appliedDiscountId, setAppliedDiscountId] = useState<string | null>(
    null,
  );
  const [discountModalOpen, setDiscountModalOpen] = useState(false);
  // Tip: percent of the discounted subtotal, or -1 for a custom dollar amount.
  const [tipPct, setTipPct] = useState<number>(0);
  const [customTip, setCustomTip] = useState<number>(0); // dollars
  // Tender step (Square/Toast pattern): tip + discount + payment live in a
  // dedicated modal opened by the big Charge button, keeping the cart clean.
  const [tenderOpen, setTenderOpen] = useState(false);
  const [showCustomer, setShowCustomer] = useState(false);
  const [showNote, setShowNote] = useState(false);

  // Unpaid orders (AI phone orders awaiting in-store payment, held orders, ...)
  const [openOrders, setOpenOrders] = useState<OpenOrderRow[]>([]);
  const [ordersDrawerOpen, setOrdersDrawerOpen] = useState(false);
  // Transaction detail drawer — opened from a row in the Transactions list.
  const [transactionOrderId, setTransactionOrderId] = useState<string | null>(
    null,
  );

  // Loaded existing order (AI voice handoff / edit mode)
  const [editingOrder, setEditingOrder] = useState<ExistingOrder | null>(null);
  // Editing a placed order needs a manager PIN (see ManagerPinModal). The pending action
  // is held here so the same gate serves both "save" and "charge".
  const [pinPrompt, setPinPrompt] = useState<
    { action: "save" } | { action: "charge"; method: "cash" | "card" } | null
  >(null);
  const [pinBusy, setPinBusy] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);

  // Modifier picker state; editingLineKey means "replace that cart line" on confirm.
  const [pickerItem, setPickerItem] = useState<MenuItem | null>(null);
  const [pickerSelections, setPickerSelections] = useState<
    Record<string, string[]>
  >({});
  const [pickerNotes, setPickerNotes] = useState("");
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
    if (!selectedLocationId) return;
    // Load once so the dine-in table picker has options in menu mode too;
    // keep live polling only while the floor plan is on screen.
    loadFloorPlans();
    if (viewMode === "floor_plan") {
      const timer = setInterval(loadFloorPlans, 10000);
      return () => clearInterval(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        setCategories((data.data ?? []).filter((c) => !c.deletedAt));
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
      .get<typeof discounts>("/discounts")
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
        setCustomerId(data.customerId ?? null);
        setOrderType(data.orderType ?? "dine_in");
        setSelectedTableId(data.tableId ?? null);
        setOrderNotes(data.specialInstructions ?? "");
        setAppliedDiscountId(data.discountId ?? null);
        if (data.tipAmount) {
          setTipPct(-1);
          setCustomTip(data.tipAmount / 100);
        }
        dispatchCart({
          type: "set",
          lines: data.items.map((item, idx) => {
            // Defensive: modifiers must be the snapshot array; tolerate rows
            // written in other shapes rather than crashing the register.
            const snaps = Array.isArray(item.modifiers) ? item.modifiers : [];
            const options: CartOption[] = snaps.map((m) => ({
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
        });
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

  const resetRegister = () => {
    dispatchCart({ type: "clear" });
    setCustomerName("");
    setCustomerId(null);
    setCustomerResults([]);
    setOrderNotes("");
    setOrderType("dine_in");
    setEditingOrder(null);
    setSelectedTableId(null);
    setAppliedDiscountId(null);
    setTipPct(0);
    setCustomTip(0);
    setTenderOpen(false);
    setShowCustomer(false);
    setShowNote(false);
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

  const handleItemTap = useCallback((item: MenuItem) => {
    if (!item.isAvailable) return;
    // Always open the picker — even items without modifier groups can take
    // per-item kitchen notes ("no onions", "extra spicy", ...).
    openPicker(item, {}, "", null);
  }, []);

  /** Pick a table for the current order. If the table already has an open
   * order, load it into the register so it can be added to, split, or paid. */
  const selectTable = useCallback(
    (tableId: string | null) => {
      setSelectedTableId(tableId);
      if (!tableId) return;
      const table = floorPlans
        .flatMap((fp) => fp.tables ?? [])
        .find((t) => t.id === tableId);
      if (table?.activeOrderId && table.activeOrderId !== editingOrder?.id) {
        setViewMode("menu");
        router.push(`/pos?orderId=${table.activeOrderId}`);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [floorPlans, editingOrder?.id],
  );

  /** Row tap in the Transactions drawer: an unpaid/open ticket loads into the
   * register (to add to, split, or take payment); a closed one opens the
   * read-only detail drawer (status, print, refund). */
  const handleSelectTransaction = (o: TxOrder) => {
    const isOpen = !o.paidAt && ["pending", "confirmed"].includes(o.status);
    if (isOpen) {
      setOrdersDrawerOpen(false);
      router.push(`/pos?orderId=${o.id}`);
    } else {
      setTransactionOrderId(o.id);
    }
  };

  // Tap a cart line → reopen the picker prefilled with that line's selections.
  const handleLineTap = useCallback(
    (line: CartLine) => {
      const item = allItems.find((i) => i.id === line.menuItemId);
      if (!item) {
        message.warning(
          "This item is no longer on the menu, so it can't be edited.",
        );
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
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allItems],
  );

  const searchCustomers = useCallback(
    async (q: string) => {
      setCustomerName(q);
      setCustomerId(null); // typing breaks the profile link
      if (q.trim().length < 2) {
        setCustomerResults([]);
        return;
      }
      try {
        const { data } = await api.get<CustomerRow[]>(
          `/customers/search?q=${encodeURIComponent(q.trim())}`,
        );
        setCustomerResults(data ?? []);
      } catch {
        // The typed name still works unlinked, but tell the cashier the lookup
        // failed instead of silently showing no matches. Keyed so repeated
        // keystrokes replace (not stack) the toast.
        message.open({
          key: "pos-customer-search",
          type: "warning",
          content: "Customer search is unavailable right now.",
        });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const handleCustomerSelect = useCallback(
    (id: string) => {
      setCustomerResults((results) => {
        const c = results.find((r) => r.id === id);
        if (c) {
          setCustomerId(c.id);
          setCustomerName(c.name);
          if (c.notes) message.info(`Customer note: ${c.notes}`, 5);
        }
        return results;
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  /** Rebuild cart lines from historical order items, repriced against the
   * current menu. Returns the lines plus how many items had to be skipped
   * (86'd or removed from the menu). */
  const linesFromHistoryItems = (
    items: {
      menuItemId: string;
      quantity: number;
      notes?: string | null;
      modifiers?: { optionId?: string }[] | null;
    }[],
  ): { lines: CartLine[]; skipped: number } => {
    let skipped = 0;
    const lines: CartLine[] = [];
    for (const it of items) {
      const menuItem = allItems.find((m) => m.id === it.menuItemId);
      if (!menuItem || !menuItem.isAvailable) {
        skipped++;
        continue;
      }
      const options: CartOption[] = [];
      for (const snap of it.modifiers ?? []) {
        if (!snap.optionId) continue;
        for (const g of menuItem.modifiers ?? []) {
          const opt = g.options.find((o) => o.id === snap.optionId);
          if (opt) {
            options.push({
              id: opt.id,
              name: opt.name,
              priceAdjustment: opt.priceAdjustment,
              groupName: g.name,
            });
            break;
          }
        }
      }
      const line = buildLine(menuItem, options, it.notes ?? undefined, undefined);
      line.quantity = it.quantity;
      lines.push(line);
    }
    return { lines, skipped };
  };

  /** One-tap reorder: rebuild the cart from the customer's most recent order,
   * repriced against the current menu (missing/86'd items are skipped). */
  const reorderLast = async () => {
    if (!customerId) return;
    setReordering(true);
    try {
      const { data } = await api.get<
        {
          items: {
            menuItemId: string;
            quantity: number;
            notes?: string | null;
            modifiers?: { optionId?: string }[] | null;
          }[];
        }[]
      >(`/customers/${customerId}/history`);
      const last = data?.[0];
      if (!last?.items?.length) {
        message.info("No previous orders for this customer.");
        return;
      }
      const { lines, skipped } = linesFromHistoryItems(last.items);
      if (lines.length === 0) {
        message.warning("None of the previous items are on the menu right now.");
        return;
      }
      dispatchCart({ type: "set", lines });
      message.success(
        `Loaded ${lines.length} item(s) from the last order${
          skipped ? ` — ${skipped} no longer available` : ""
        }.`,
      );
    } catch {
      message.error("Failed to load order history.");
    } finally {
      setReordering(false);
    }
  };

  // Duplicate an order into a fresh cart (?duplicateOrder=<id>): items are
  // repriced against the current menu and nothing links back to the original.
  // Waits for the menu so lines can be rebuilt; runs once per navigation.
  useEffect(() => {
    if (!duplicateOrderId || allItems.length === 0 || duplicatedRef.current)
      return;
    duplicatedRef.current = true;
    api
      .get<ExistingOrder>(`/orders/${duplicateOrderId}`)
      .then(({ data }) => {
        const { lines, skipped } = linesFromHistoryItems(data.items);
        if (lines.length === 0) {
          message.warning(
            "None of that order's items are on the menu right now.",
          );
          return;
        }
        dispatchCart({ type: "set", lines });
        setOrderType(data.orderType ?? "dine_in");
        setCustomerName(
          data.customerName === "Walk-in" ? "" : data.customerName,
        );
        setCustomerId(data.customerId ?? null);
        message.success(
          `Duplicated order ${orderLabel(data)} — ${lines.length} item(s)${
            skipped ? `, ${skipped} no longer available` : ""
          }. This is a new order.`,
          5,
        );
      })
      .catch(() => message.error("Failed to duplicate the order."))
      .finally(() => router.replace("/pos"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duplicateOrderId, allItems.length]);

  const handlePickerConfirm = (options: CartOption[], notes?: string) => {
    if (!pickerItem) return;
    if (editingLineKey) {
      dispatchCart({
        type: "replace",
        key: editingLineKey,
        line: buildLine(pickerItem, options, notes, undefined),
      });
    } else {
      dispatchCart({
        type: "add",
        line: buildLine(pickerItem, options, notes, undefined),
      });
    }
    setPickerItem(null);
    setEditingLineKey(null);
  };

  const cartPayloadItems = () =>
    cart.map((l) => ({
      menuItemId: l.menuItemId,
      quantity: l.quantity,
      optionIds: l.options.map((o) => o.id).filter(Boolean),
      notes: l.notes,
      course: l.course,
    }));

  /** Shared body for creating/persisting the order (save, charge, split). */
  const orderMetaPayload = () => ({
    customerName: customerName.trim() || undefined,
    customerId: customerId ?? undefined,
    orderType,
    specialInstructions: orderNotes.trim() || undefined,
    discountId: appliedDiscountId ?? undefined,
    items: cartPayloadItems(),
  });

  /**
   * Save without paying: new carts become unpaid orders (kitchen fires, receipt
   * waits), edited orders get their changes persisted. Either way the register
   * clears and the order waits in Open Orders until it's charged.
   */
  const saveOrder = async (managerPin?: string) => {
    if (!selectedLocationId || cart.length === 0) return;
    // An order already sent to the kitchen cannot be rewritten without authorisation.
    if (editingOrder && !managerPin) {
      setPinError(null);
      setPinPrompt({ action: "save" });
      return;
    }
    setSaving(true);
    try {
      if (editingOrder) {
        await api.put(`/orders/${editingOrder.id}/items`, {
          ...orderMetaPayload(),
          managerPin,
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
            tableId:
              orderType === "dine_in" ? selectedTableId ?? undefined : undefined,
            ...orderMetaPayload(),
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
    } catch (err) {
      // The server explains why — wrong PIN, order already paid — and that detail is the
      // difference between "try again" and "stop trying".
      const detail = (err as { response?: { data?: { message?: string | string[] } } })
        ?.response?.data?.message;
      message.error(
        Array.isArray(detail) ? detail.join(", ") : detail || "Failed to save the order.",
      );
      throw err;
    } finally {
      setSaving(false);
    }
  };

  const charge = async (method: "cash" | "card", managerPin?: string) => {
    if (!selectedLocationId || cart.length === 0) return;
    // Charging an edited order persists the edit first, which needs the same authorisation.
    if (editingOrder && !managerPin) {
      setPinError(null);
      setPinPrompt({ action: "charge", method });
      return;
    }
    setCharging(method);
    try {
      let paid: { ticketNumber?: number | null; id: string; totalAmount: number };
      if (editingOrder) {
        // Persist any edits, then record the payment on the existing order.
        await api.put(`/orders/${editingOrder.id}/items`, {
          ...orderMetaPayload(),
          managerPin,
        });
        const res = await api.post<typeof paid>(
          `/orders/${editingOrder.id}/pay`,
          { paymentMethod: method, tipAmount },
        );
        paid = res.data;
      } else {
        const res = await api.post<typeof paid>("/orders/pos", {
          locationId: selectedLocationId,
          tableId:
            orderType === "dine_in" ? selectedTableId ?? undefined : undefined,
          paymentMethod: method,
          tipAmount,
          ...orderMetaPayload(),
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
    } catch (err) {
      const detail = (err as { response?: { data?: { message?: string | string[] } } })
        ?.response?.data?.message;
      message.error(
        Array.isArray(detail)
          ? detail.join(", ")
          : detail || "Failed to place the order. Nothing was charged.",
      );
      // Rethrown so the PIN prompt can stay open on a rejected PIN instead of closing
      // over a charge that never happened.
      throw err;
    } finally {
      setCharging(null);
    }
  };

  /** Create (or persist edits to) the order so split payments can attach. */
  const persistOrderForSplit = async (): Promise<PersistedOrder> => {
    if (!selectedLocationId || cart.length === 0) {
      throw new Error("Nothing to split.");
    }
    if (editingOrder) {
      const res = await api.put<PersistedOrder>(
        `/orders/${editingOrder.id}/items`,
        orderMetaPayload(),
      );
      return res.data;
    }
    const res = await api.post<PersistedOrder>("/orders/pos", {
      locationId: selectedLocationId,
      tableId: orderType === "dine_in" ? selectedTableId ?? undefined : undefined,
      ...orderMetaPayload(),
    });
    return res.data;
  };

  /** Tender flow finished (paid in full or parked mid-split). */
  const handleTenderSettled = () => {
    const wasEditing = editingOrder !== null;
    resetRegister();
    loadOpenOrders();
    if (wasEditing) router.replace("/pos");
  };

  const openTransactions = useCallback(() => {
    loadOpenOrders();
    setOrdersDrawerOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLocationId]);

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

  const busy = saving || charging !== null;

  return (
    <div>
      {/* Compact register toolbar — a full PageHeader wastes vertical space the
          item grid needs on an iPad. Editing state lives here too. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: token.marginSM,
          marginBottom: token.marginSM,
          minHeight: 40,
        }}
      >
        <Title level={4} style={{ margin: 0, whiteSpace: "nowrap" }}>
          Register
        </Title>
        <Radio.Group
          value={viewMode}
          onChange={(e) => setViewMode(e.target.value as "menu" | "floor_plan")}
          buttonStyle="solid"
          size="large"
          aria-label="Register view"
        >
          <Radio.Button value="menu">Menu</Radio.Button>
          <Radio.Button value="floor_plan">Floor Plan</Radio.Button>
        </Radio.Group>
        <div style={{ flex: 1 }} />
        {editingOrder && (
          <Alert
            type="info"
            showIcon
            title={`Editing ${orderLabel(editingOrder)}${
              editingOrder.source === "ai_phone" ? " (AI phone order)" : ""
            }`}
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
            style={{ padding: "4px 12px" }}
          />
        )}
      </div>

      {/* Height, wrapping, and touch behavior live in globals.css (.pos-*) so they
          can respond to iPad/tablet breakpoints; colors stay tokenized inline. */}
      <div className="pos-register" style={{ gap: token.marginSM }}>
        {viewMode === "menu" ? (
          <MenuPanel
            categories={categories}
            openOrdersCount={openOrders.length}
            onOpenTransactions={openTransactions}
            onItemTap={handleItemTap}
          />
        ) : (
          <FloorPlanView
            floorPlans={floorPlans}
            selectedTableId={selectedTableId}
            onSelectTable={selectTable}
          />
        )}

        {/* Cart panel — width is fluid on tablets (globals.css .pos-cart) */}
        <CartPanel
          cart={cart}
          dispatchCart={dispatchCart}
          editingOrder={editingOrder}
          orderType={orderType}
          onOrderTypeChange={setOrderType}
          floorPlans={floorPlans}
          selectedTableId={selectedTableId}
          onSelectTable={selectTable}
          customerName={customerName}
          customerId={customerId}
          customerResults={customerResults}
          onCustomerSearch={searchCustomers}
          onCustomerSelect={handleCustomerSelect}
          reordering={reordering}
          onReorderLast={reorderLast}
          showCustomer={showCustomer}
          onShowCustomer={() => setShowCustomer(true)}
          showNote={showNote}
          onShowNote={() => setShowNote(true)}
          orderNotes={orderNotes}
          onOrderNotesChange={setOrderNotes}
          appliedDiscount={appliedDiscount}
          discountAmount={discountAmount}
          onClearDiscount={() => setAppliedDiscountId(null)}
          onOpenDiscount={() => setDiscountModalOpen(true)}
          onLineTap={handleLineTap}
          subtotal={subtotal}
          taxRateBps={taxRateBps}
          taxAmount={taxAmount}
          tipAmount={tipAmount}
          total={total}
          saving={saving}
          busy={busy}
          onOpenTender={() => setTenderOpen(true)}
          onSaveOrder={saveOrder}
        />
      </div>

      {/* Transactions hub — date range, live totals, open/closed, source filters */}
      <TransactionsListDrawer
        open={ordersDrawerOpen}
        onClose={() => setOrdersDrawerOpen(false)}
        locationId={selectedLocationId}
        onSelect={handleSelectTransaction}
      />

      {/* Single-transaction detail — status actions, print (opened from a row) */}
      <TransactionDrawer
        orderId={transactionOrderId}
        open={transactionOrderId !== null}
        onClose={() => setTransactionOrderId(null)}
        isAdmin={userRole !== "user"}
        onChanged={loadOpenOrders}
      />

      {/* Tender step — total, tip, discount, then payment (Square/Toast flow) */}
      <ManagerPinModal
        open={pinPrompt !== null}
        title={
          editingOrder
            ? `Authorize changes to ${orderLabel(editingOrder)}`
            : "Manager authorization"
        }
        busy={pinBusy}
        error={pinError}
        onCancel={() => {
          setPinPrompt(null);
          setPinError(null);
        }}
        onSubmit={(pin) => {
          if (!pinPrompt) return;
          setPinBusy(true);
          setPinError(null);
          const run =
            pinPrompt.action === "save"
              ? saveOrder(pin)
              : charge(pinPrompt.method, pin);
          void run
            .then(() => setPinPrompt(null))
            .catch((err: unknown) => {
              // Keep the prompt open on a bad PIN so it can be retyped; the message
              // already surfaced as a toast, this puts it where the eye is.
              const detail = (
                err as { response?: { data?: { message?: string | string[] } } }
              )?.response?.data?.message;
              setPinError(
                Array.isArray(detail)
                  ? detail.join(", ")
                  : detail || "Could not authorize that change.",
              );
            })
            .finally(() => setPinBusy(false));
        }}
      />

      <TenderModal
        open={tenderOpen}
        onClose={() => setTenderOpen(false)}
        onSettled={handleTenderSettled}
        editingOrderLabel={editingOrder ? orderLabel(editingOrder) : null}
        total={total}
        subtotal={subtotal}
        discountAmount={discountAmount}
        taxAmount={taxAmount}
        tipAmount={tipAmount}
        tipPct={tipPct}
        onTipPctChange={setTipPct}
        customTip={customTip}
        onCustomTipChange={setCustomTip}
        appliedDiscount={appliedDiscount}
        onClearDiscount={() => setAppliedDiscountId(null)}
        onOpenDiscount={() => setDiscountModalOpen(true)}
        charging={charging}
        onCharge={charge}
        persistOrder={persistOrderForSplit}
      />

      {/* Modifier picker */}
      <ModifierPickerModal
        item={pickerItem}
        initialSelections={pickerSelections}
        initialNotes={pickerNotes}
        editing={editingLineKey !== null}
        onCancel={() => {
          setPickerItem(null);
          setEditingLineKey(null);
        }}
        onConfirm={handlePickerConfirm}
      />

      {/* Discount picker */}
      <DiscountModal
        open={discountModalOpen}
        onClose={() => setDiscountModalOpen(false)}
        discounts={discounts}
        canApplyManagerDiscounts={canApplyManagerDiscounts}
        onApply={setAppliedDiscountId}
      />
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
