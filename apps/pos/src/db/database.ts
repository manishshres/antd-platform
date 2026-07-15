import * as SQLite from 'expo-sqlite';

/**
 * Single persistent on-device database. Everything the register needs to run
 * offline lives here: the catalog cache, customers, table map, and the local
 * order queue (held / pending sync / synced).
 */
export const db = SQLite.openDatabaseSync('coneeko-pos.db');

export function migrate(): void {
  db.execSync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY NOT NULL,
      category_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      price INTEGER NOT NULL,
      image_url TEXT,
      is_available INTEGER NOT NULL DEFAULT 1,
      is_favorite INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);

    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      notes TEXT,
      dirty INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS dining_tables (
      id TEXT PRIMARY KEY NOT NULL,
      floor_plan_id TEXT NOT NULL,
      floor_plan_name TEXT NOT NULL,
      name TEXT NOT NULL,
      capacity INTEGER NOT NULL DEFAULT 4,
      shape TEXT NOT NULL DEFAULT 'rectangle',
      status TEXT NOT NULL DEFAULT 'vacant'
    );

    CREATE TABLE IF NOT EXISTS locations (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      tax_rate_bps INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY NOT NULL,
      server_id TEXT,
      ticket_number INTEGER,
      status TEXT NOT NULL,
      items_json TEXT NOT NULL,
      customer_id TEXT,
      customer_name TEXT NOT NULL DEFAULT 'Walk-in',
      customer_phone TEXT NOT NULL DEFAULT '',
      table_id TEXT,
      table_name TEXT,
      guests INTEGER,
      order_type TEXT NOT NULL DEFAULT 'dine_in',
      subtotal INTEGER NOT NULL,
      discount_id TEXT,
      discount_name TEXT,
      discount_amount INTEGER NOT NULL DEFAULT 0,
      tax_amount INTEGER NOT NULL,
      total_amount INTEGER NOT NULL,
      payment_method TEXT,
      tendered_amount INTEGER,
      change_amount INTEGER,
      special_instructions TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL,
      synced_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

    CREATE TABLE IF NOT EXISTS discounts (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      code TEXT,
      type TEXT NOT NULL,
      value INTEGER NOT NULL,
      requires_manager INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS drawer_sessions (
      id TEXT PRIMARY KEY NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      opened_at TEXT NOT NULL,
      closed_at TEXT,
      opening_amount INTEGER NOT NULL,
      cash_sales INTEGER NOT NULL DEFAULT 0,
      other_sales INTEGER NOT NULL DEFAULT 0,
      expected_amount INTEGER,
      counted_amount INTEGER,
      difference INTEGER,
      remarks TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_drawer_status ON drawer_sessions(status);
  `);

  // Versioned upgrades for databases created before a column existed.
  // (CREATE TABLE IF NOT EXISTS above never alters an existing table.)
  const row = db.getFirstSync<{ user_version: number }>('PRAGMA user_version');
  const version = row?.user_version ?? 0;
  if (version < 2) {
    const orderCols = db
      .getAllSync<{ name: string }>('PRAGMA table_info(orders)')
      .map((c) => c.name);
    if (!orderCols.includes('discount_id')) {
      db.execSync(`
        ALTER TABLE orders ADD COLUMN discount_id TEXT;
        ALTER TABLE orders ADD COLUMN discount_name TEXT;
        ALTER TABLE orders ADD COLUMN discount_amount INTEGER NOT NULL DEFAULT 0;
      `);
    }
    db.execSync('PRAGMA user_version = 2');
  }
  if (version < 3) {
    const tableCols = db
      .getAllSync<{ name: string }>('PRAGMA table_info(dining_tables)')
      .map((c) => c.name);
    if (!tableCols.includes('active_order_id')) {
      db.execSync('ALTER TABLE dining_tables ADD COLUMN active_order_id TEXT');
    }
    if (!tableCols.includes('active_order_total')) {
      db.execSync(
        'ALTER TABLE dining_tables ADD COLUMN active_order_total INTEGER NOT NULL DEFAULT 0',
      );
    }
    db.execSync('PRAGMA user_version = 3');
  }
}

export function getMeta(key: string): string | null {
  const row = db.getFirstSync<{ value: string | null }>(
    'SELECT value FROM meta WHERE key = ?',
    [key],
  );
  return row?.value ?? null;
}

export function setMeta(key: string, value: string): void {
  db.runSync(
    'INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, value],
  );
}
