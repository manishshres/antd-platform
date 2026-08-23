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
      sort_order INTEGER NOT NULL DEFAULT 0,
      sku TEXT,
      is_combo INTEGER NOT NULL DEFAULT 0,
      tax_exempt INTEGER NOT NULL DEFAULT 0,
      stock_quantity INTEGER,
      low_stock_threshold INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);

    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      notes TEXT,
      dirty INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      loyalty_points INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS dining_tables (
      id TEXT PRIMARY KEY NOT NULL,
      floor_plan_id TEXT NOT NULL,
      floor_plan_name TEXT NOT NULL,
      floor_plan_width INTEGER NOT NULL DEFAULT 800,
      floor_plan_height INTEGER NOT NULL DEFAULT 600,
      name TEXT NOT NULL,
      capacity INTEGER NOT NULL DEFAULT 4,
      shape TEXT NOT NULL DEFAULT 'rectangle',
      status TEXT NOT NULL DEFAULT 'vacant',
      pos_x INTEGER NOT NULL DEFAULT 0,
      pos_y INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS locations (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      tax_rate_bps INTEGER NOT NULL DEFAULT 0,
      service_charge_bps INTEGER NOT NULL DEFAULT 0,
      organization_name TEXT
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
      tip_amount INTEGER NOT NULL DEFAULT 0,
      service_charge_amount INTEGER NOT NULL DEFAULT 0,
      loyalty_points_redeemed INTEGER NOT NULL DEFAULT 0,
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

    -- Outbox of operations owed to the server. The orders table holds display
    -- state; this holds transport state. Draining in created_at order is what
    -- lets a tab be opened offline: the 'create' lands first and writes back
    -- the server id that the later 'append'/'settle' rows address.
    CREATE TABLE IF NOT EXISTS order_mutations (
      id TEXT PRIMARY KEY NOT NULL,
      order_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_order_mutations_order ON order_mutations(order_id);
    CREATE INDEX IF NOT EXISTS idx_order_mutations_created ON order_mutations(created_at);
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
  if (version < 4) {
    const orderCols = db
      .getAllSync<{ name: string }>('PRAGMA table_info(orders)')
      .map((c) => c.name);
    if (!orderCols.includes('tab_opened_at')) {
      db.execSync('ALTER TABLE orders ADD COLUMN tab_opened_at TEXT');
    }
    db.execSync('PRAGMA user_version = 4');
  }
  if (version < 5) {
    const orderCols = db
      .getAllSync<{ name: string }>('PRAGMA table_info(orders)')
      .map((c) => c.name);
    // Course/firedAt on the lines themselves ride inside items_json, so only
    // the order-level firing mode needs a column.
    if (!orderCols.includes('fire_mode')) {
      db.execSync(
        "ALTER TABLE orders ADD COLUMN fire_mode TEXT NOT NULL DEFAULT 'all'",
      );
    }
    db.execSync('PRAGMA user_version = 5');
  }
  if (version < 6) {
    const productCols = db
      .getAllSync<{ name: string }>('PRAGMA table_info(products)')
      .map((c) => c.name);
    if (!productCols.includes('modifiers_json')) {
      db.execSync(
        "ALTER TABLE products ADD COLUMN modifiers_json TEXT NOT NULL DEFAULT '[]'",
      );
    }
    db.execSync('PRAGMA user_version = 6');
  }
  if (version < 7) {
    const orderCols = db
      .getAllSync<{ name: string }>('PRAGMA table_info(orders)')
      .map((c) => c.name);
    if (!orderCols.includes('tip_amount')) {
      db.execSync(
        'ALTER TABLE orders ADD COLUMN tip_amount INTEGER NOT NULL DEFAULT 0',
      );
    }
    db.execSync('PRAGMA user_version = 7');
  }
  if (version < 8) {
    const productCols = db
      .getAllSync<{ name: string }>('PRAGMA table_info(products)')
      .map((c) => c.name);
    if (!productCols.includes('sku')) {
      db.execSync('ALTER TABLE products ADD COLUMN sku TEXT');
      db.execSync('CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku)');
    }
    db.execSync('PRAGMA user_version = 8');
  }
  if (version < 9) {
    const productCols = db
      .getAllSync<{ name: string }>('PRAGMA table_info(products)')
      .map((c) => c.name);
    if (!productCols.includes('is_combo')) {
      db.execSync(`
        ALTER TABLE products ADD COLUMN is_combo INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE products ADD COLUMN tax_exempt INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE products ADD COLUMN stock_quantity INTEGER;
        ALTER TABLE products ADD COLUMN low_stock_threshold INTEGER;
      `);
    }
    db.execSync('PRAGMA user_version = 9');
  }
  if (version < 10) {
    const locationCols = db
      .getAllSync<{ name: string }>('PRAGMA table_info(locations)')
      .map((c) => c.name);
    if (!locationCols.includes('service_charge_bps')) {
      db.execSync(
        'ALTER TABLE locations ADD COLUMN service_charge_bps INTEGER NOT NULL DEFAULT 0',
      );
    }
    const orderCols = db
      .getAllSync<{ name: string }>('PRAGMA table_info(orders)')
      .map((c) => c.name);
    if (!orderCols.includes('service_charge_amount')) {
      db.execSync(
        'ALTER TABLE orders ADD COLUMN service_charge_amount INTEGER NOT NULL DEFAULT 0',
      );
    }
    db.execSync('PRAGMA user_version = 10');
  }
  if (version < 11) {
    const customerCols = db
      .getAllSync<{ name: string }>('PRAGMA table_info(customers)')
      .map((c) => c.name);
    if (!customerCols.includes('loyalty_points')) {
      db.execSync(
        'ALTER TABLE customers ADD COLUMN loyalty_points INTEGER NOT NULL DEFAULT 0',
      );
    }
    db.execSync('PRAGMA user_version = 11');
  }
  if (version < 12) {
    const orderCols = db
      .getAllSync<{ name: string }>('PRAGMA table_info(orders)')
      .map((c) => c.name);
    if (!orderCols.includes('loyalty_points_redeemed')) {
      db.execSync(
        'ALTER TABLE orders ADD COLUMN loyalty_points_redeemed INTEGER NOT NULL DEFAULT 0',
      );
    }
    db.execSync('PRAGMA user_version = 12');
  }
  if (version < 13) {
    const tableCols = db
      .getAllSync<{ name: string }>('PRAGMA table_info(dining_tables)')
      .map((c) => c.name);
    if (!tableCols.includes('pos_x')) {
      db.execSync(`
        ALTER TABLE dining_tables ADD COLUMN pos_x INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE dining_tables ADD COLUMN pos_y INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE dining_tables ADD COLUMN floor_plan_width INTEGER NOT NULL DEFAULT 800;
        ALTER TABLE dining_tables ADD COLUMN floor_plan_height INTEGER NOT NULL DEFAULT 600;
      `);
    }
    db.execSync('PRAGMA user_version = 13');
  }

  if (version < 14) {
    // Kitchen stations + category routing are local-only (Bluetooth pairing is
    // per-tablet) and deliberately NOT columns on `categories`, since
    // replaceCatalog() below does DELETE FROM categories + re-insert on every
    // sync pull — a column there would be wiped every time. Keying the mapping
    // by the server's stable category id lets it survive re-sync instead.
    db.execSync(`
      CREATE TABLE IF NOT EXISTS printer_stations (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        printer_target TEXT NOT NULL DEFAULT '',
        printer_device_name TEXT NOT NULL DEFAULT '',
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS category_stations (
        category_id TEXT PRIMARY KEY NOT NULL,
        station_id TEXT NOT NULL REFERENCES printer_stations(id) ON DELETE CASCADE
      );
    `);
    db.execSync('PRAGMA user_version = 14');
  }

  if (version < 15) {
    // The server's /locations already returns address/city/state/phone (see
    // LocationsService.listLocations' unfiltered select) — these columns were
    // just never added locally, so replaceLocations had nothing to store them
    // in and Settings had nothing to read them from.
    const locationCols = db
      .getAllSync<{ name: string }>('PRAGMA table_info(locations)')
      .map((c) => c.name);
    if (!locationCols.includes('address')) {
      db.execSync(`
        ALTER TABLE locations ADD COLUMN address TEXT;
        ALTER TABLE locations ADD COLUMN city TEXT;
        ALTER TABLE locations ADD COLUMN state TEXT;
        ALTER TABLE locations ADD COLUMN postal_code TEXT;
        ALTER TABLE locations ADD COLUMN phone_number TEXT;
      `);
    }
    db.execSync('PRAGMA user_version = 15');
  }

  if (version < 16) {
    db.execSync(`
      CREATE TABLE IF NOT EXISTS business_days (
        id TEXT PRIMARY KEY NOT NULL,
        date TEXT NOT NULL,
        opened_at TEXT NOT NULL,
        closed_at TEXT,
        opened_by TEXT NOT NULL DEFAULT '',
        closed_by TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_business_days_date ON business_days(date);
    `);
    const orderCols = db
      .getAllSync<{ name: string }>('PRAGMA table_info(orders)')
      .map((c) => c.name);
    if (!orderCols.includes('business_day_id')) {
      db.execSync('ALTER TABLE orders ADD COLUMN business_day_id TEXT');
    }
    db.execSync('PRAGMA user_version = 16');
  }

  if (version < 17) {
    // Cart lines gained a stable `lineId`. Orders written before that have
    // items without one, and `lineIdForItem` falls back to the old
    // product:course key for them — which collapses two lines of the same dish
    // that differ only by modifiers, exactly the bug the id was added to fix.
    // Backfill once so no locally stored order relies on that fallback. It
    // stays in place for orders mapped down from the server, which have no
    // local line identity to carry.
    const rows = db.getAllSync<{ id: string; items_json: string }>(
      'SELECT id, items_json FROM orders',
    );
    for (const row of rows) {
      let items: { lineId?: string }[];
      try {
        items = JSON.parse(row.items_json) as { lineId?: string }[];
      } catch {
        continue; // unparseable row: leave it alone rather than destroy it
      }
      if (!Array.isArray(items) || items.every((i) => i.lineId)) continue;
      const patched = items.map((item, i) => ({
        ...item,
        // Deterministic and unique per row — no RN uuid import in the DB layer,
        // and these only need to be stable, not random.
        lineId: item.lineId ?? `${row.id}:${i}`,
      }));
      db.runSync('UPDATE orders SET items_json = ? WHERE id = ?', [
        JSON.stringify(patched),
        row.id,
      ]);
    }
    db.execSync('PRAGMA user_version = 17');
  }

  if (version < 18) {
    // Durable kitchen print queue. Printing is a side effect of an order, never
    // a precondition for it — a dead printer must not stop the register taking
    // orders — so jobs live here and are retried independently of the send that
    // created them.
    //
    // `lines_json` is the *rendered* ticket, snapshotted at enqueue. Rebuilding
    // it from the order at print time would be wrong: by the time a failed job
    // retries, the tab may have gained items the kitchen was never meant to see
    // on this ticket.
    db.execSync(`
      CREATE TABLE IF NOT EXISTS print_jobs (
        id TEXT PRIMARY KEY NOT NULL,
        order_id TEXT NOT NULL,
        station_name TEXT NOT NULL DEFAULT 'Kitchen',
        target TEXT NOT NULL DEFAULT '',
        lines_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued',
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_print_jobs_status ON print_jobs(status);
      CREATE INDEX IF NOT EXISTS idx_print_jobs_order ON print_jobs(order_id);
    `);
    db.execSync('PRAGMA user_version = 18');
  }

  if (version < 19) {
    // The receipt header shows the business name, not just the branch: "Manayunk" alone
    // tells a customer nothing about who they bought from.
    const locationCols = db
      .getAllSync<{ name: string }>('PRAGMA table_info(locations)')
      .map((c) => c.name);
    if (!locationCols.includes('organization_name')) {
      db.execSync('ALTER TABLE locations ADD COLUMN organization_name TEXT');
    }
    db.execSync('PRAGMA user_version = 19');
  }

  // Ensure indexes exist regardless of creation path.
  // (Deferred from initial schema to avoid referencing columns that
  //  may not exist on pre-migration databases.)
  db.execSync('CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku)');
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
