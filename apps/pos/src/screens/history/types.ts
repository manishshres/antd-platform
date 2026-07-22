import type { LocalOrder, ServerOrderDetail } from '../../types';

export type ActiveTab = 'history' | 'tabs' | 'hold' | 'offline';

export interface HistoryRow {
  key: string;
  ticket: string;
  customerName: string;
  status: string;
  totalAmount: number;
  createdAt: string;
  local: boolean;
}

export type DetailState =
  | { kind: 'empty' }
  | { kind: 'loading' }
  | { kind: 'local'; order: LocalOrder }
  | { kind: 'server'; order: ServerOrderDetail }
  | { kind: 'error'; message: string };
