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
import { discountAmountFor, taxFor } from '../utils/money';
import { newId } from '../utils/ids';
import { getDiscounts } from '../db/catalogRepo';

interface CartTotals {
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  totalAmount: number;
  itemCount: number;
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

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [table, setTableState] = useState<DiningTable | null>(null);
  const [guests, setGuests] = useState<number | null>(null);
  const [orderType, setOrderType] = useState<OrderType>('dine_in');
  const [discount, setDiscount] = useState<Discount | null>(null);
  const [resumedOrderId, setResumedOrderId] = useState<string | null>(null);

  const addProduct = useCallback((product: Product) => {
    setLines((prev) => {
      const existing = prev.find((l) => l.product.id === product.id);
      if (existing) {
        return prev.map((l) =>
          l.product.id === product.id ? { ...l, quantity: l.quantity + 1 } : l,
        );
      }
      return [...prev, { product, quantity: 1 }];
    });
  }, []);

  const addProductWithOptions = useCallback(
    (product: Product, quantity: number, notes?: string) => {
      setLines((prev) => {
        const idx = prev.findIndex((l) => l.product.id === product.id);
        if (idx === -1) {
          return [...prev, { product, quantity, notes }];
        }
        return prev.map((l, i) =>
          i === idx
            ? { ...l, quantity: l.quantity + quantity, notes: notes || l.notes }
            : l,
        );
      });
    },
    [],
  );

  const setQuantity = useCallback((productId: string, quantity: number) => {
    setLines((prev) =>
      quantity <= 0
        ? prev.filter((l) => l.product.id !== productId)
        : prev.map((l) =>
            l.product.id === productId ? { ...l, quantity } : l,
          ),
    );
  }, []);

  const updateLine = useCallback(
    (productId: string, quantity: number, notes?: string) => {
      setLines((prev) =>
        quantity <= 0
          ? prev.filter((l) => l.product.id !== productId)
          : prev.map((l) =>
              l.product.id === productId ? { ...l, quantity, notes } : l,
            ),
      );
    },
    [],
  );

  const removeLine = useCallback((productId: string) => {
    setLines((prev) => prev.filter((l) => l.product.id !== productId));
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
    setLines(
      order.items.map((item) => ({
        product: {
          id: item.menuItemId,
          categoryId: '',
          name: item.name,
          description: null,
          price: item.unitPrice,
          imageUrl: null,
          isAvailable: true,
          isFavorite: false,
          sortOrder: 0,
        },
        quantity: item.quantity,
        notes: item.notes,
      })),
    );
    setCustomer(
      order.customerId || order.customerName !== 'Walk-in'
        ? {
            id: order.customerId ?? '',
            name: order.customerName,
            phone: order.customerPhone || null,
            email: null,
            notes: null,
            dirty: false,
            updatedAt: order.createdAt,
          }
        : null,
    );
    setTableState(
      order.tableId && order.tableName
        ? {
            id: order.tableId,
            floorPlanId: '',
            floorPlanName: '',
            name: order.tableName,
            capacity: order.guests ?? 4,
            shape: 'rectangle',
            status: 'vacant',
            activeOrderId: null,
            activeOrderTotal: 0,
          }
        : null,
    );
    setGuests(order.guests);
    setOrderType(order.orderType);
    // Prefer the live cached discount (percent discounts keep scaling when the
    // resumed cart is edited); fall back to a fixed snapshot of the amount if
    // it disappeared from the cache while the order was held.
    setDiscount(
      order.discountId
        ? (getDiscounts().find((d) => d.id === order.discountId) ?? {
            id: order.discountId,
            name: order.discountName ?? 'Discount',
            code: null,
            type: 'fixed',
            value: order.discountAmount,
            requiresManager: false,
          })
        : null,
    );
    setResumedOrderId(order.id);
  }, []);

  const totals = useCallback(
    (taxRateBps: number): CartTotals => {
      const subtotal = lines.reduce(
        (sum, l) => sum + l.product.price * l.quantity,
        0,
      );
      // Same tender math as the backend's createPosOrder: discount reduces
      // the taxable base, tax applies to the discounted subtotal.
      const discountAmount = discountAmountFor(discount, subtotal);
      const taxableBase = subtotal - discountAmount;
      const taxAmount = taxFor(taxableBase, taxRateBps);
      return {
        subtotal,
        discountAmount,
        taxAmount,
        totalAmount: taxableBase + taxAmount,
        itemCount: lines.reduce((sum, l) => sum + l.quantity, 0),
      };
    },
    [lines, discount],
  );

  const buildOrder = useCallback(
    (taxRateBps: number, overrides?: Partial<LocalOrder>): LocalOrder => {
      const t = totals(taxRateBps);
      return {
        id: resumedOrderId ?? newId(),
        serverId: null,
        ticketNumber: null,
        status: 'held',
        items: lines.map((l) => ({
          menuItemId: l.product.id,
          name: l.product.name,
          unitPrice: l.product.price,
          quantity: l.quantity,
          notes: l.notes,
        })),
        customerId: customer?.id || null,
        customerName: customer?.name || 'Walk-in',
        customerPhone: customer?.phone || '',
        tableId: table?.id ?? null,
        tableName: table?.name ?? null,
        guests,
        orderType,
        subtotal: t.subtotal,
        discountId: discount?.id ?? null,
        discountName: discount?.name ?? null,
        discountAmount: t.discountAmount,
        taxAmount: t.taxAmount,
        totalAmount: t.totalAmount,
        paymentMethod: null,
        tenderedAmount: null,
        changeAmount: null,
        specialInstructions: null,
        errorMessage: null,
        createdAt: new Date().toISOString(),
        syncedAt: null,
        ...overrides,
      };
    },
    [lines, customer, table, guests, orderType, discount, resumedOrderId, totals],
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
