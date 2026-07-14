import { db } from './database';
import type { LocalOrder, LocalOrderItem, LocalOrderStatus } from '../types';

interface OrderRow {
  id: string;
  server_id: string | null;
  ticket_number: number | null;
  status: string;
  items_json: string;
  customer_id: string | null;
  customer_name: string;
  customer_phone: string;
  table_id: string | null;
  table_name: string | null;
  guests: number | null;
  order_type: string;
  subtotal: number;
  discount_id: string | null;
  discount_name: string | null;
  discount_amount: number;
  tax_amount: number;
  total_amount: number;
  payment_method: string | null;
  tendered_amount: number | null;
  change_amount: number | null;
  special_instructions: string | null;
  error_message: string | null;
  created_at: string;
  synced_at: string | null;
}

function toOrder(row: OrderRow): LocalOrder {
  let items: LocalOrderItem[] = [];
  try {
    items = JSON.parse(row.items_json) as LocalOrderItem[];
  } catch {
    items = [];
  }
  return {
    id: row.id,
    serverId: row.server_id,
    ticketNumber: row.ticket_number,
    status: row.status as LocalOrderStatus,
    items,
    customerId: row.customer_id,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    tableId: row.table_id,
    tableName: row.table_name,
    guests: row.guests,
    orderType: (row.order_type as LocalOrder['orderType']) || 'dine_in',
    subtotal: row.subtotal,
    discountId: row.discount_id,
    discountName: row.discount_name,
    discountAmount: row.discount_amount ?? 0,
    taxAmount: row.tax_amount,
    totalAmount: row.total_amount,
    paymentMethod: row.payment_method as LocalOrder['paymentMethod'],
    tenderedAmount: row.tendered_amount,
    changeAmount: row.change_amount,
    specialInstructions: row.special_instructions,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    syncedAt: row.synced_at,
  };
}

export function saveOrder(order: LocalOrder): void {
  db.runSync(
    `INSERT INTO orders(
       id, server_id, ticket_number, status, items_json, customer_id, customer_name,
       customer_phone, table_id, table_name, guests, order_type, subtotal, discount_id,
       discount_name, discount_amount, tax_amount,
       total_amount, payment_method, tendered_amount, change_amount, special_instructions,
       error_message, created_at, synced_at
     ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       status = excluded.status, items_json = excluded.items_json,
       customer_id = excluded.customer_id, customer_name = excluded.customer_name,
       customer_phone = excluded.customer_phone, table_id = excluded.table_id,
       table_name = excluded.table_name, guests = excluded.guests,
       order_type = excluded.order_type, subtotal = excluded.subtotal,
       discount_id = excluded.discount_id, discount_name = excluded.discount_name,
       discount_amount = excluded.discount_amount,
       tax_amount = excluded.tax_amount, total_amount = excluded.total_amount,
       payment_method = excluded.payment_method, tendered_amount = excluded.tendered_amount,
       change_amount = excluded.change_amount, special_instructions = excluded.special_instructions,
       error_message = excluded.error_message`,
    [
      order.id,
      order.serverId,
      order.ticketNumber,
      order.status,
      JSON.stringify(order.items),
      order.customerId,
      order.customerName,
      order.customerPhone,
      order.tableId,
      order.tableName,
      order.guests,
      order.orderType,
      order.subtotal,
      order.discountId,
      order.discountName,
      order.discountAmount,
      order.taxAmount,
      order.totalAmount,
      order.paymentMethod,
      order.tenderedAmount,
      order.changeAmount,
      order.specialInstructions,
      order.errorMessage,
      order.createdAt,
      order.syncedAt,
    ],
  );
}

export function getOrderById(id: string): LocalOrder | null {
  const row = db.getFirstSync<OrderRow>('SELECT * FROM orders WHERE id = ?', [id]);
  return row ? toOrder(row) : null;
}

export function listOrders(statuses: LocalOrderStatus[]): LocalOrder[] {
  const placeholders = statuses.map(() => '?').join(', ');
  return db
    .getAllSync<OrderRow>(
      `SELECT * FROM orders WHERE status IN (${placeholders}) ORDER BY created_at DESC`,
      statuses,
    )
    .map(toOrder);
}

export function countOrders(status: LocalOrderStatus): number {
  const row = db.getFirstSync<{ n: number }>(
    'SELECT COUNT(*) AS n FROM orders WHERE status = ?',
    [status],
  );
  return row?.n ?? 0;
}

export function deleteOrder(id: string): void {
  db.runSync('DELETE FROM orders WHERE id = ?', [id]);
}

export function markSynced(
  id: string,
  serverId: string,
  ticketNumber: number | null,
): void {
  db.runSync(
    `UPDATE orders SET status = 'synced', server_id = ?, ticket_number = ?,
     error_message = NULL, synced_at = ? WHERE id = ?`,
    [serverId, ticketNumber, new Date().toISOString(), id],
  );
}

export function markFailed(id: string, message: string): void {
  db.runSync(
    `UPDATE orders SET status = 'failed', error_message = ? WHERE id = ?`,
    [message, id],
  );
}

/** Retry a failed order: put it back in the sync queue. */
export function requeue(id: string): void {
  db.runSync(
    `UPDATE orders SET status = 'pending_sync', error_message = NULL WHERE id = ?`,
    [id],
  );
}
