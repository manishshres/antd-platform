import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type {
  CartLine,
  Course,
  Customer,
  DiningTable,
  Discount,
  LocalOrder,
  OrderType,
  Product,
  SelectedModifier,
} from '../types';
import {
  addLine,
  addLineWithOptions,
  buildLocalOrder,
  cartTotals,
  customerFromOrder,
  discountFromOrder,
  lineIdForItem,
  linesDelta,
  linesFromOrder,
  removeLineFrom,
  setLineQuantity,
  setLinePriceOverride,
  tableFromOrder,
  updateLineDetails,
  type CartTotals,
} from './cartOps';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useApp } from './AppContext';

/**
 * The in-progress cart is otherwise pure in-memory state, so a crash or OS kill
 * mid-order loses whatever the cashier had rung up. We snapshot a *plain* draft
 * (a fresh or resumed order) to storage on every change and restore it on
 * launch. Tabs and split-checks are deliberately excluded — those already live
 * durably in SQLite; re-hydrating them from here would race that source of
 * truth. The draft is the one thing with no other home.
 */
const DRAFT_KEY = 'pos.cart.draft.v1';

interface CartDraft {
  lines: CartLine[];
  customer: Customer | null;
  table: DiningTable | null;
  guests: number | null;
  orderType: OrderType;
  discount: Discount | null;
  resumedOrderId: string | null;
}

interface CartContextValue {
  lines: CartLine[];
  customer: Customer | null;
  table: DiningTable | null;
  guests: number | null;
  orderType: OrderType;
  discount: Discount | null;
  /** When resuming a held order, the original local id is kept. */
  resumedOrderId: string | null;
  /** Set when the cart is attached to an open tab rather than a fresh ticket. */
  tabOrderId: string | null;
  tabOpenedAt: string | null;
  /**
   * Lines the tab already had when it was loaded. Everything above this is
   * what an append sends; it also floors the quantity controls, since
   * reducing a line that already fired is a void, not a negative append.
   */
  tabBaseline: CartLine[];
  addProduct: (product: Product, course?: Course) => void;
  addProductWithOptions: (
    product: Product,
    quantity: number,
    notes?: string,
    course?: Course,
    selectedModifiers?: SelectedModifier[],
  ) => void;
  setQuantity: (lineId: string, quantity: number) => void;
  updateLine: (
    lineId: string,
    quantity: number,
    notes?: string,
    course?: Course,
    selectedModifiers?: SelectedModifier[],
  ) => void;
  removeLine: (lineId: string) => void;
  /** Manager-authorized: set (or clear, with undefined) a line's replacement price. */
  setPriceOverride: (
    lineId: string,
    priceOverride: number | undefined,
    priceOverrideReason?: string,
  ) => void;
  /** Which course new items land on; also the default in the item dialog. */
  activeCourse: Course | undefined;
  setActiveCourse: (course: Course | undefined) => void;
  fireMode: LocalOrder['fireMode'];
  setFireMode: (mode: LocalOrder['fireMode']) => void;
  setCustomer: (customer: Customer | null) => void;
  setTable: (table: DiningTable | null, guests?: number | null) => void;
  setOrderType: (type: OrderType) => void;
  setDiscount: (discount: Discount | null) => void;
  clear: () => void;
  loadOrder: (order: LocalOrder) => void;
  /** Attach the cart to an existing open tab (from the floor map or tab list). */
  loadTab: (order: LocalOrder) => void;
  /** Items added since the tab was loaded — the payload for an append. */
  tabDelta: () => {
    menuItemId: string;
    quantity: number;
    notes?: string;
    course?: Course;
    optionIds?: string[];
  }[];
  totals: (
    taxRateBps: number,
    serviceChargeBps?: number,
    applyServiceCharge?: boolean,
  ) => CartTotals;
  /** Snapshot the cart into a LocalOrder (caller decides held vs pending_sync). */
  buildOrder: (
    taxRateBps: number,
    overrides?: Partial<LocalOrder>,
  ) => LocalOrder;

  // ── Split checks ──────────────────────────────────────────────────────────
  /** Null outside a split-check flow; otherwise how many checks and how many are paid so far. */
  splitPlan: { total: number; paidCount: number } | null;
  /** Begin a split: `lines` becomes the first check, the rest queue behind it. */
  startSplitChecks: (groups: CartLine[][]) => void;
  /** Call after the active check is paid. Loads the next check into `lines`, or
   *  finishes the split (returns false) once every check has been paid. */
  advanceSplitCheck: () => boolean;
  /** Abandon the split and restore the original, unsplit cart. */
  cancelSplit: () => void;
}

const CartContext = createContext<CartContextValue | null>(null);

/**
 * Thin state wrapper around the pure transitions in `cartOps.ts` — the
 * provider only wires React state; all cart math/mapping lives there.
 */
export function CartProvider({ children }: { children: React.ReactNode }) {
  const { businessDay } = useApp();
  const [lines, setLines] = useState<CartLine[]>([]);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [table, setTableState] = useState<DiningTable | null>(null);
  const [guests, setGuests] = useState<number | null>(null);
  const [orderType, setOrderType] = useState<OrderType>('dine_in');
  const [discount, setDiscount] = useState<Discount | null>(null);
  const [resumedOrderId, setResumedOrderId] = useState<string | null>(null);
  const [tabOrderId, setTabOrderId] = useState<string | null>(null);
  const [tabOpenedAt, setTabOpenedAt] = useState<string | null>(null);
  const [tabBaseline, setTabBaseline] = useState<CartLine[]>([]);
  const [activeCourse, setActiveCourse] = useState<Course | undefined>(undefined);
  const [fireMode, setFireMode] = useState<LocalOrder['fireMode']>('all');
  // Fire times from the loaded tab, keyed by line id — carried through a
  // rebuild so re-saving a tab can't un-fire what the kitchen already has.
  const [firedAtByLine, setFiredAtByLine] = useState<
    Record<string, string | null>
  >({});

  // Split-check flow: `lines` always holds the check currently being paid;
  // the rest queue here until their turn, and the pre-split cart is kept so
  // cancelling can restore it exactly.
  const [splitQueue, setSplitQueue] = useState<CartLine[][] | null>(null);
  const [splitTotal, setSplitTotal] = useState<number | null>(null);
  const [splitPaidCount, setSplitPaidCount] = useState(0);
  const [splitOriginalLines, setSplitOriginalLines] = useState<CartLine[] | null>(null);

  // Persist only once the initial restore has run, so an empty first render
  // doesn't clobber a saved draft before we've had a chance to load it.
  const draftReady = useRef(false);

  useEffect(() => {
    AsyncStorage.getItem(DRAFT_KEY)
      .then((raw) => {
        if (!raw) return;
        const d = JSON.parse(raw) as CartDraft;
        if (!d.lines?.length) return;
        setLines(d.lines);
        setCustomer(d.customer);
        setTableState(d.table);
        setGuests(d.guests);
        setOrderType(d.orderType);
        setDiscount(d.discount);
        setResumedOrderId(d.resumedOrderId);
      })
      .catch(() => {})
      .finally(() => {
        draftReady.current = true;
      });
  }, []);

  // Snapshot the plain draft on any change. Tabs (tabOrderId) and split-checks
  // (splitQueue) are backed elsewhere, so we don't shadow them here — and an
  // empty cart clears the draft rather than persisting nothing.
  useEffect(() => {
    if (!draftReady.current) return;
    const isPlainDraft = !tabOrderId && !splitQueue;
    if (!isPlainDraft || lines.length === 0) {
      void AsyncStorage.removeItem(DRAFT_KEY);
      return;
    }
    const draft: CartDraft = {
      lines,
      customer,
      table,
      guests,
      orderType,
      discount,
      resumedOrderId,
    };
    void AsyncStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  }, [lines, customer, table, guests, orderType, discount, resumedOrderId, tabOrderId, splitQueue]);

  const addProduct = useCallback(
    (product: Product, course?: Course) => {
      setLines((prev) => addLine(prev, product, course ?? activeCourse));
    },
    [activeCourse],
  );

  const addProductWithOptions = useCallback(
    (
      product: Product,
      quantity: number,
      notes?: string,
      course?: Course,
      selectedModifiers?: SelectedModifier[],
    ) => {
      setLines((prev) =>
        addLineWithOptions(
          prev,
          product,
          quantity,
          notes,
          course,
          selectedModifiers,
        ),
      );
    },
    [],
  );

  /** How many of this line the kitchen has already been told to cook. */
  const firedQuantityFor = useCallback(
    (lineId: string): number =>
      tabBaseline.find((l) => l.id === lineId)?.quantity ?? 0,
    [tabBaseline],
  );

  const setQuantity = useCallback(
    (lineId: string, quantity: number) => {
      const fired = firedQuantityFor(lineId);
      setLines((prev) =>
        setLineQuantity(prev, lineId, Math.max(quantity, fired)),
      );
    },
    [firedQuantityFor],
  );

  const updateLine = useCallback(
    (
      lineId: string,
      quantity: number,
      notes?: string,
      course?: Course,
      selectedModifiers?: SelectedModifier[],
    ) => {
      // The cart must never fall below what the kitchen is already cooking.
      // The stepper's minus button enforces this, but the customize dialog can
      // set an arbitrary quantity and bypassed it — and because `linesDelta`
      // only reports `added > 0`, a reduction emitted nothing at all. The
      // kitchen kept cooking three while the POS billed one. Clamping here
      // covers every path into a line, not just the one button.
      const fired = firedQuantityFor(lineId);
      setLines((prev) =>
        updateLineDetails(
          prev,
          lineId,
          Math.max(quantity, fired),
          notes,
          course,
          selectedModifiers,
        ),
      );
    },
    [firedQuantityFor],
  );

  const removeLine = useCallback(
    (lineId: string) => {
      // Same reasoning: dropping a fired line outright is an un-send. Reversing
      // fired food is a void — manager-gated and deliberately not this path.
      if (firedQuantityFor(lineId) > 0) return;
      setLines((prev) => removeLineFrom(prev, lineId));
    },
    [firedQuantityFor],
  );

  const setPriceOverride = useCallback(
    (
      lineId: string,
      priceOverride: number | undefined,
      priceOverrideReason?: string,
    ) => {
      setLines((prev) =>
        setLinePriceOverride(prev, lineId, priceOverride, priceOverrideReason),
      );
    },
    [],
  );

  const setTable = useCallback(
    (next: DiningTable | null, guestCount?: number | null) => {
      setTableState(next);
      setGuests(guestCount ?? null);
      if (next) setOrderType('dine_in');
    },
    [],
  );

  // Pickup/delivery are table-less order types — switching to either one drops
  // any attached table so the order isn't left mislabeled as dine-in.
  const changeOrderType = useCallback((type: OrderType) => {
    setOrderType(type);
    if (type !== 'dine_in') {
      setTableState(null);
      setGuests(null);
    }
  }, []);

  const clear = useCallback(() => {
    setLines([]);
    setCustomer(null);
    setTableState(null);
    setGuests(null);
    setOrderType('dine_in');
    setDiscount(null);
    setResumedOrderId(null);
    setTabOrderId(null);
    setTabOpenedAt(null);
    setTabBaseline([]);
    setActiveCourse(undefined);
    setFireMode('all');
    setFiredAtByLine({});
    setSplitQueue(null);
    setSplitTotal(null);
    setSplitPaidCount(0);
    setSplitOriginalLines(null);
  }, []);

  const startSplitChecks = useCallback(
    (groups: CartLine[][]) => {
      if (groups.length === 0) return;
      setSplitOriginalLines(lines);
      setSplitTotal(groups.length);
      setSplitPaidCount(0);
      setSplitQueue(groups.slice(1));
      setLines(groups[0]);
    },
    [lines],
  );

  const advanceSplitCheck = useCallback((): boolean => {
    setSplitPaidCount((n) => n + 1);
    if (splitQueue && splitQueue.length > 0) {
      setLines(splitQueue[0]);
      setSplitQueue(splitQueue.slice(1));
      return true;
    }
    setSplitQueue(null);
    setSplitTotal(null);
    setSplitOriginalLines(null);
    return false;
  }, [splitQueue]);

  const cancelSplit = useCallback(() => {
    if (splitOriginalLines) setLines(splitOriginalLines);
    setSplitQueue(null);
    setSplitTotal(null);
    setSplitPaidCount(0);
    setSplitOriginalLines(null);
  }, [splitOriginalLines]);

  const loadOrder = useCallback((order: LocalOrder) => {
    setLines(linesFromOrder(order));
    setCustomer(customerFromOrder(order));
    setTableState(tableFromOrder(order));
    setGuests(order.guests);
    setOrderType(order.orderType);
    setDiscount(discountFromOrder(order));
    setResumedOrderId(order.id);
    setTabOrderId(null);
    setTabOpenedAt(null);
    setTabBaseline([]);
    setActiveCourse(undefined);
    setFireMode(order.fireMode ?? 'all');
    setFiredAtByLine({});
  }, []);

  const loadTab = useCallback((order: LocalOrder) => {
    const existing = linesFromOrder(order);
    setLines(existing);
    setCustomer(customerFromOrder(order));
    setTableState(tableFromOrder(order));
    setGuests(order.guests);
    setOrderType(order.orderType);
    setDiscount(discountFromOrder(order));
    setResumedOrderId(null);
    setTabOrderId(order.id);
    setTabOpenedAt(order.tabOpenedAt ?? order.createdAt);
    setTabBaseline(existing);
    setActiveCourse(undefined);
    setFireMode(order.fireMode ?? 'all');
    setFiredAtByLine(
      Object.fromEntries(
        order.items.map((i) => [lineIdForItem(i), i.firedAt ?? null]),
      ),
    );
  }, []);

  const tabDelta = useCallback(
    () => linesDelta(tabBaseline, lines),
    [tabBaseline, lines],
  );

  const totals = useCallback(
    (
      taxRateBps: number,
      serviceChargeBps?: number,
      applyServiceCharge?: boolean,
    ): CartTotals =>
      cartTotals(
        lines,
        discount,
        taxRateBps,
        serviceChargeBps,
        applyServiceCharge,
      ),
    [lines, discount],
  );

  const buildOrder = useCallback(
    (taxRateBps: number, overrides?: Partial<LocalOrder>): LocalOrder =>
      buildLocalOrder(
        {
          lines,
          customer,
          table,
          guests,
          orderType,
          discount,
          resumedOrderId,
          tabOrderId,
          tabOpenedAt,
          fireMode,
          firedAtByLine,
        },
        taxRateBps,
        {
          businessDayId: businessDay?.id ?? null,
          ...overrides,
        },
      ),
    [
      lines,
      customer,
      table,
      guests,
      orderType,
      discount,
      resumedOrderId,
      tabOrderId,
      tabOpenedAt,
      fireMode,
      firedAtByLine,
      businessDay?.id,
    ],
  );

  const value = useMemo(
    () => ({
      lines,
      customer,
      table,
      guests,
      orderType,
      discount,
      resumedOrderId,
      tabOrderId,
      tabOpenedAt,
      tabBaseline,
      activeCourse,
      setActiveCourse,
      fireMode,
      setFireMode,
      addProduct,
      addProductWithOptions,
      setQuantity,
      updateLine,
      removeLine,
      setPriceOverride,
      setCustomer,
      setTable,
      setOrderType: changeOrderType,
      setDiscount,
      clear,
      loadOrder,
      loadTab,
      tabDelta,
      totals,
      buildOrder,
      splitPlan: splitTotal !== null ? { total: splitTotal, paidCount: splitPaidCount } : null,
      startSplitChecks,
      advanceSplitCheck,
      cancelSplit,
    }),
    [
      lines,
      customer,
      table,
      guests,
      orderType,
      discount,
      resumedOrderId,
      tabOrderId,
      tabOpenedAt,
      tabBaseline,
      activeCourse,
      setActiveCourse,
      fireMode,
      setFireMode,
      addProduct,
      addProductWithOptions,
      setQuantity,
      updateLine,
      removeLine,
      setPriceOverride,
      setTable,
      changeOrderType,
      clear,
      loadOrder,
      loadTab,
      tabDelta,
      totals,
      buildOrder,
      splitTotal,
      splitPaidCount,
      startSplitChecks,
      advanceSplitCheck,
      cancelSplit,
    ],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used inside CartProvider');
  return ctx;
}
