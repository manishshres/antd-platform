export type ScreenName =
  | 'home'
  | 'customers'
  | 'tables'
  | 'payment'
  | 'history'
  | 'kds'
  | 'drawer'
  | 'reports'
  | 'callHistory'
  | 'settings';

/**
 * What the register knows about the current moment. Nav items declare what they
 * need via `requires`, so an action is never shown when tapping it would lead to
 * a dead end (e.g. Pay with an empty cart, Tables at a counter-only location).
 */
export interface NavContext {
  /** Backend-derived (`MANAGER_ROLES`) — gates the Admin section. */
  isManager: boolean;
  /** This location has a floor plan; counter-only sites never see Tables. */
  hasTables: boolean;
}

export interface NavItem {
  key: ScreenName;
  label: string;
  icon: string;
  /** Absent = always visible. */
  requires?: (ctx: NavContext) => boolean;
}

/**
 * The rail. Kept to the handful of destinations a cashier touches during a rush —
 * everything else is one tap away behind More, and setup lives in Admin.
 */
export const PRIMARY_NAV: NavItem[] = [
  { key: 'home', label: 'New Order', icon: 'plus-box-outline' },
  {
    key: 'tables',
    label: 'Tables',
    icon: 'table-furniture',
    requires: (c) => c.hasTables,
  },
  { key: 'history', label: 'Orders', icon: 'receipt-text-outline' },
  { key: 'customers', label: 'Customers', icon: 'account-multiple-outline' },
  // Payment is deliberately absent: tendering belongs to the open order, so the
  // only route to it is the cart's own Proceed button (primary, bottom of the
  // cart, disabled while empty). A nav entry would be a second path to a screen
  // that is meaningless without the cart it acts on.
];

/** Secondary destinations — real screens, just not rush-hour ones. */
export const MORE_NAV: NavItem[] = [
  { key: 'kds', label: 'Kitchen Display', icon: 'chef-hat' },
  { key: 'drawer', label: 'Cash Drawer', icon: 'cash-register' },
  { key: 'callHistory', label: 'Call History', icon: 'phone-log-outline' },
];

/** Back-of-house. Hidden outright from non-managers. */
export const ADMIN_NAV: NavItem[] = [
  { key: 'reports', label: 'Reports', icon: 'chart-bar' },
  { key: 'settings', label: 'Settings', icon: 'cog-outline' },
];

export function visibleNav(items: NavItem[], ctx: NavContext): NavItem[] {
  return items.filter((item) => !item.requires || item.requires(ctx));
}

/**
 * Admin is a permission boundary in the UI only — every underlying route is
 * enforced server-side. Hiding it here is about keeping setup out of the way
 * mid-service, not about security.
 */
export function adminNavFor(ctx: NavContext): NavItem[] {
  return ctx.isManager ? ADMIN_NAV : [];
}

const ADMIN_KEYS = new Set<ScreenName>(ADMIN_NAV.map((i) => i.key));

/** True for back-of-house screens a non-manager should never be sitting on. */
export function isAdminScreen(screen: ScreenName): boolean {
  return ADMIN_KEYS.has(screen);
}

/** Screens reachable from More/Admin — used to keep the More button lit while on one. */
const SECONDARY_KEYS = new Set<ScreenName>([
  ...MORE_NAV.map((i) => i.key),
  ...ADMIN_NAV.map((i) => i.key),
]);

export function isSecondaryScreen(screen: ScreenName): boolean {
  return SECONDARY_KEYS.has(screen);
}
