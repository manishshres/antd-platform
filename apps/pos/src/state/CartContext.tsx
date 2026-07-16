import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';
import type {
  CartLine,
  Customer,
  DiningTable,
  Discount,
  LocalOrder,
  OrderType,
  Product,
} from '../types';
import {
  addLine,
  addLineWithOptions,
  buildLocalOrder,
  cartTotals,
  customerFromOrder,
  discountFromOrder,
  linesFromOrder,
  removeLineFrom,
  setLineQuantity,
  tableFromOrder,
  updateLineDetails,
  type CartTotals,
} from './cartOps';

interface CartContextValue {
  lines: CartLine[];
  customer: Customer | null;
  table: DiningTable | null;
  guests: number | null;
  orderType: OrderType;
  discount: Discount | null;
  /** When resuming a held order, the original local id is kept. */
  resumedOrderId: string | null;
  addProduct: (product: Product) => void;
  addProductWithOptions: (product: Product, quantity: number, notes?: string) => void;
  setQuantity: (productId: string, quantity: number) => void;
  updateLine: (productId: string, quantity: number, notes?: string) => void;
  removeLine: (productId: string) => void;
  setCustomer: (customer: Customer | null) => void;
  setTable: (table: DiningTable | null, guests?: number | null) => void;
  setOrderType: (type: OrderType) => void;
  setDiscount: (discount: Discount | null) => void;
  clear: () => void;
  loadOrder: (order: LocalOrder) => void;
  totals: (taxRateBps: number) => CartTotals;
  /** Snapshot the cart into a LocalOrder (caller decides held vs pending_sync). */
  buildOrder: (
    taxRateBps: number,
    overrides?: Partial<LocalOrder>,
  ) => LocalOrder;
}

const CartContext = createContext<CartContextValue | null>(null);

/**
 * Thin state wrapper around the pure transitions in `cartOps.ts` — the
 * provider only wires React state; all cart math/mapping lives there.
 */
export function CartProvider({ children }: { children: React.ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [table, setTableState] = useState<DiningTable | null>(null);
  const [guests, setGuests] = useState<number | null>(null);
  const [orderType, setOrderType] = useState<OrderType>('dine_in');
  const [discount, setDiscount] = useState<Discount | null>(null);
  const [resumedOrderId, setResumedOrderId] = useState<string | null>(null);

  const addProduct = useCallback((product: Product) => {
    setLines((prev) => addLine(prev, product));
  }, []);

  const addProductWithOptions = useCallback(
    (product: Product, quantity: number, notes?: string) => {
      setLines((prev) => addLineWithOptions(prev, product, quantity, notes));
    },
    [],
  );

  const setQuantity = useCallback((productId: string, quantity: number) => {
    setLines((prev) => setLineQuantity(prev, productId, quantity));
  }, []);

  const updateLine = useCallback(
    (productId: string, quantity: number, notes?: string) => {
      setLines((prev) => updateLineDetails(prev, productId, quantity, notes));
    },
    [],
  );

  const removeLine = useCallback((productId: string) => {
    setLines((prev) => removeLineFrom(prev, productId));
  }, []);

  const setTable = useCallback(
    (next: DiningTable | null, guestCount?: number | null) => {
      setTableState(next);
      setGuests(guestCount ?? null);
      if (next) setOrderType('dine_in');
    },
    [],
  );

  const clear = useCallback(() => {
    setLines([]);
    setCustomer(null);
    setTableState(null);
    setGuests(null);
    setOrderType('dine_in');
    setDiscount(null);
    setResumedOrderId(null);
  }, []);

  const loadOrder = useCallback((order: LocalOrder) => {
    setLines(linesFromOrder(order));
    setCustomer(customerFromOrder(order));
    setTableState(tableFromOrder(order));
    setGuests(order.guests);
    setOrderType(order.orderType);
    setDiscount(discountFromOrder(order));
    setResumedOrderId(order.id);
  }, []);

  const totals = useCallback(
    (taxRateBps: number): CartTotals => cartTotals(lines, discount, taxRateBps),
    [lines, discount],
  );

  const buildOrder = useCallback(
    (taxRateBps: number, overrides?: Partial<LocalOrder>): LocalOrder =>
      buildLocalOrder(
        { lines, customer, table, guests, orderType, discount, resumedOrderId },
        taxRateBps,
        overrides,
      ),
    [lines, customer, table, guests, orderType, discount, resumedOrderId],
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
      addProduct,
      addProductWithOptions,
      setQuantity,
      updateLine,
      removeLine,
      setCustomer,
      setTable,
      setOrderType,
      setDiscount,
      clear,
      loadOrder,
      totals,
      buildOrder,
    }),
    [
      lines,
      customer,
      table,
      guests,
      orderType,
      discount,
      resumedOrderId,
      addProduct,
      addProductWithOptions,
      setQuantity,
      updateLine,
      removeLine,
      setTable,
      clear,
      loadOrder,
      totals,
      buildOrder,
    ],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used inside CartProvider');
  return ctx;
}
