import { db } from './database';
import { newId } from '../utils/ids';
import type { Customer } from '../types';

interface CustomerRow {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  dirty: number;
  updated_at: string;
}

function toCustomer(row: CustomerRow): Customer {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    notes: row.notes,
    dirty: row.dirty === 1,
    updatedAt: row.updated_at,
  };
}

export function listCustomers(search?: string): Customer[] {
  if (search?.trim()) {
    const like = `%${search.trim()}%`;
    return db
      .getAllSync<CustomerRow>(
        'SELECT * FROM customers WHERE name LIKE ? OR phone LIKE ? ORDER BY updated_at DESC LIMIT 50',
        [like, like],
      )
      .map(toCustomer);
  }
  return db
    .getAllSync<CustomerRow>(
      'SELECT * FROM customers ORDER BY updated_at DESC LIMIT 50',
    )
    .map(toCustomer);
}

/** Create a customer locally; marked dirty until the sync engine pushes it. */
export function createLocalCustomer(payload: {
  name: string;
  phone?: string;
  email?: string;
}): Customer {
  const customer: Customer = {
    id: newId(),
    name: payload.name.trim(),
    phone: payload.phone?.trim() || null,
    email: payload.email?.trim() || null,
    notes: null,
    dirty: true,
    updatedAt: new Date().toISOString(),
  };
  db.runSync(
    'INSERT INTO customers(id, name, phone, email, notes, dirty, updated_at) VALUES(?, ?, ?, ?, ?, 1, ?)',
    [
      customer.id,
      customer.name,
      customer.phone,
      customer.email,
      customer.notes,
      customer.updatedAt,
    ],
  );
  return customer;
}

export function listDirtyCustomers(): Customer[] {
  return db
    .getAllSync<CustomerRow>('SELECT * FROM customers WHERE dirty = 1')
    .map(toCustomer);
}

/**
 * A dirty local customer was accepted by the server: swap the local row for
 * the canonical server one and repoint any queued orders at the new id.
 */
export function resolveLocalCustomer(localId: string, server: Customer): void {
  db.withTransactionSync(() => {
    db.runSync('DELETE FROM customers WHERE id = ?', [localId]);
    db.runSync(
      `INSERT INTO customers(id, name, phone, email, notes, dirty, updated_at)
       VALUES(?, ?, ?, ?, ?, 0, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, phone = excluded.phone,
         email = excluded.email, notes = excluded.notes, dirty = 0, updated_at = excluded.updated_at`,
      [
        server.id,
        server.name,
        server.phone,
        server.email,
        server.notes,
        server.updatedAt ?? new Date().toISOString(),
      ],
    );
    db.runSync('UPDATE orders SET customer_id = ? WHERE customer_id = ?', [
      server.id,
      localId,
    ]);
  });
}

/** Merge the server's customer list in, without clobbering unsynced local edits. */
export function mergeServerCustomers(customers: Customer[]): void {
  db.withTransactionSync(() => {
    for (const c of customers) {
      db.runSync(
        `INSERT INTO customers(id, name, phone, email, notes, dirty, updated_at)
         VALUES(?, ?, ?, ?, ?, 0, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, phone = excluded.phone,
           email = excluded.email, notes = excluded.notes, dirty = 0, updated_at = excluded.updated_at
         WHERE customers.dirty = 0`,
        [
          c.id,
          c.name,
          c.phone ?? null,
          c.email ?? null,
          c.notes ?? null,
          c.updatedAt ?? new Date().toISOString(),
        ],
      );
    }
  });
}
