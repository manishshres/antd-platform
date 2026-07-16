import type { CartLine, CartOption, MenuItem } from "./types";

/**
 * Monotonic line keys: a timestamp alone collides when the same item is
 * double-tapped within one millisecond, silently merging two lines' React
 * state. The counter guarantees uniqueness for the lifetime of the page.
 */
let lineSeq = 0;
const nextLineKey = (menuItemId: string) => `${menuItemId}-${++lineSeq}`;

export const buildLine = (
  item: MenuItem,
  options: CartOption[],
  notes?: string,
  course?: number,
): CartLine => {
  const optsPrice = options.reduce((sum, o) => sum + o.priceAdjustment, 0);
  return {
    key: nextLineKey(item.id),
    menuItemId: item.id,
    name: item.name,
    unitPrice: item.price + optsPrice,
    quantity: 1,
    options,
    notes,
    course,
  };
};

export type CartAction =
  | { type: "set"; lines: CartLine[] }
  | { type: "clear" }
  | { type: "add"; line: CartLine }
  /** Swap a line's item/options but keep its key and quantity (picker edit). */
  | { type: "replace"; key: string; line: CartLine }
  | { type: "updateQty"; key: string; delta: number }
  | { type: "duplicate"; key: string };

export function cartReducer(state: CartLine[], action: CartAction): CartLine[] {
  switch (action.type) {
    case "set":
      return action.lines;
    case "clear":
      return [];
    case "add":
      return [...state, action.line];
    case "replace":
      return state.map((l) =>
        l.key === action.key
          ? { ...action.line, key: l.key, quantity: l.quantity }
          : l,
      );
    case "updateQty":
      return state
        .map((l) =>
          l.key === action.key ? { ...l, quantity: l.quantity + action.delta } : l,
        )
        .filter((l) => l.quantity > 0);
    case "duplicate": {
      const line = state.find((l) => l.key === action.key);
      if (!line) return state;
      return [
        ...state,
        { ...line, key: nextLineKey(line.menuItemId), quantity: 1 },
      ];
    }
  }
}
