export type ScreenName =
  | 'home'
  | 'customers'
  | 'tables'
  | 'payment'
  | 'history'
  | 'reports'
  | 'settings';

export interface NavItem {
  key: ScreenName;
  label: string;
  icon: string;
}

export const NAV_ITEMS: NavItem[] = [
  { key: 'home', label: 'Home', icon: 'home-variant-outline' },
  { key: 'customers', label: 'Customers', icon: 'account-multiple-outline' },
  { key: 'tables', label: 'Tables', icon: 'table-furniture' },
  { key: 'history', label: 'Orders', icon: 'receipt-text-outline' },
  { key: 'reports', label: 'Reports', icon: 'chart-bar' },
  { key: 'settings', label: 'Settings', icon: 'cog-outline' },
];
