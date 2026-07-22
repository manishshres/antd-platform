import { db } from './database';
import type {
  Category,
  DiningTable,
  Discount,
  Location,
  Product,
} from '../types';
import type { FloorPlanPayload, MenuCategoryPayload } from '../api/client';

interface ProductRow {
  id: string;
  category_id: string;
  name: string;
  description: string | null;
  price: number;
  image_url: string | null;
  is_available: number;
  is_favorite: number;
  sort_order: number;
  modifiers_json: string | null;
  sku: string | null;
  is_combo: number;
  tax_exempt: number;
  stock_quantity: number | null;
  low_stock_threshold: number | null;
}

function toProduct(row: ProductRow): Product {
  return {
    id: row.id,
    categoryId: row.category_id,
    name: row.name,
    description: row.description,
    price: row.price,
    imageUrl: row.image_url,
    isAvailable: row.is_available === 1,
    isFavorite: row.is_favorite === 1,
    sortOrder: row.sort_order,
    modifiers: row.modifiers_json ? JSON.parse(row.modifiers_json) : [],
    sku: row.sku,
    isCombo: row.is_combo === 1,
    taxExempt: row.tax_exempt === 1,
    stockQuantity: row.stock_quantity,
    lowStockThreshold: row.low_stock_threshold,
  };
}

/** Replace the cached catalog wholesale with the server's copy. */
export function replaceCatalog(categories: MenuCategoryPayload[]): void {
  db.withTransactionSync(() => {
    db.runSync('DELETE FROM categories');
    db.runSync('DELETE FROM products');
    for (const cat of categories) {
      db.runSync(
        'INSERT INTO categories(id, name, sort_order) VALUES(?, ?, ?)',
        [cat.id, cat.name, cat.sortOrder ?? 0],
      );
      for (const item of cat.items ?? []) {
        db.runSync(
          `INSERT INTO products(id, category_id, name, description, price, image_url, is_available, is_favorite, sort_order, modifiers_json, sku, is_combo, tax_exempt, stock_quantity, low_stock_threshold)
           VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            item.id,
            cat.id,
            item.name,
            item.description ?? null,
            item.price,
            item.imageUrl ?? null,
            item.isAvailable === false ? 0 : 1,
            item.isFavorite ? 1 : 0,
            item.sortOrder ?? 0,
            JSON.stringify(item.modifiers ?? []),
            item.sku ?? null,
            item.isCombo ? 1 : 0,
            item.taxExempt ? 1 : 0,
            item.stockQuantity ?? null,
            item.lowStockThreshold ?? null,
          ],
        );
      }
    }
  });
}

export function getCategories(): Category[] {
  return db
    .getAllSync<{ id: string; name: string; sort_order: number }>(
      'SELECT id, name, sort_order FROM categories ORDER BY sort_order, name',
    )
    .map((r) => ({ id: r.id, name: r.name, sortOrder: r.sort_order }));
}

export function getProducts(categoryId?: string, search?: string): Product[] {
  const conditions: string[] = ['is_available = 1'];
  const params: (string | number)[] = [];
  if (categoryId) {
    conditions.push('category_id = ?');
    params.push(categoryId);
  }
  if (search?.trim()) {
    conditions.push('name LIKE ?');
    params.push(`%${search.trim()}%`);
  }
  const rows = db.getAllSync<ProductRow>(
    `SELECT * FROM products WHERE ${conditions.join(' AND ')} ORDER BY sort_order, name`,
    params,
  );
  return rows.map(toProduct);
}

/** All cached products regardless of availability — for menu management, where a
 *  manager needs to see (and re-enable) disabled items too. */
export function getAllProducts(categoryId?: string): Product[] {
  const rows = categoryId
    ? db.getAllSync<ProductRow>(
        'SELECT * FROM products WHERE category_id = ? ORDER BY sort_order, name',
        [categoryId],
      )
    : db.getAllSync<ProductRow>('SELECT * FROM products ORDER BY sort_order, name');
  return rows.map(toProduct);
}

export function getProductById(id: string): Product | null {
  const row = db.getFirstSync<ProductRow>('SELECT * FROM products WHERE id = ?', [id]);
  return row ? toProduct(row) : null;
}

export function findProductBySku(sku: string): Product | null {
  const normalized = sku.trim();
  if (!normalized) return null;
  const row = db.getFirstSync<ProductRow>(
    'SELECT * FROM products WHERE sku = ? AND is_available = 1 LIMIT 1',
    [normalized],
  );
  return row ? toProduct(row) : null;
}

export function replaceLocations(locations: Location[]): void {
  db.withTransactionSync(() => {
    db.runSync('DELETE FROM locations');
    for (const loc of locations) {
      db.runSync(
        `INSERT INTO locations(id, name, tax_rate_bps, service_charge_bps, address, city, state, postal_code, phone_number)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          loc.id,
          loc.name,
          loc.taxRateBps ?? 0,
          loc.serviceChargeBps ?? 0,
          loc.address ?? null,
          loc.city ?? null,
          loc.state ?? null,
          loc.postalCode ?? null,
          loc.phoneNumber ?? null,
        ],
      );
    }
  });
}

export function getLocations(): Location[] {
  return db
    .getAllSync<{
      id: string;
      name: string;
      tax_rate_bps: number;
      service_charge_bps: number;
      address: string | null;
      city: string | null;
      state: string | null;
      postal_code: string | null;
      phone_number: string | null;
    }>(
      `SELECT id, name, tax_rate_bps, service_charge_bps, address, city, state, postal_code, phone_number
       FROM locations ORDER BY name`,
    )
    .map((r) => ({
      id: r.id,
      name: r.name,
      taxRateBps: r.tax_rate_bps,
      serviceChargeBps: r.service_charge_bps,
      address: r.address,
      city: r.city,
      state: r.state,
      postalCode: r.postal_code,
      phoneNumber: r.phone_number,
    }));
}

/** Locally update a location's tax and service charge rates. */
export function updateLocationTax(
  locationId: string,
  taxRateBps: number,
  serviceChargeBps: number,
): void {
  db.runSync(
    `UPDATE locations SET tax_rate_bps = ?, service_charge_bps = ? WHERE id = ?`,
    [taxRateBps, serviceChargeBps, locationId],
  );
}

export function replaceDiscounts(discounts: Discount[]): void {
  db.withTransactionSync(() => {
    db.runSync('DELETE FROM discounts');
    for (const d of discounts) {
      db.runSync(
        'INSERT INTO discounts(id, name, code, type, value, requires_manager) VALUES(?, ?, ?, ?, ?, ?)',
        [
          d.id,
          d.name,
          d.code ?? null,
          d.type,
          d.value,
          d.requiresManager ? 1 : 0,
        ],
      );
    }
  });
}

export function getDiscounts(): Discount[] {
  return db
    .getAllSync<{
      id: string;
      name: string;
      code: string | null;
      type: string;
      value: number;
      requires_manager: number;
    }>('SELECT * FROM discounts ORDER BY name')
    .map((r) => ({
      id: r.id,
      name: r.name,
      code: r.code,
      type: r.type === 'fixed' ? 'fixed' : 'percent',
      value: r.value,
      requiresManager: r.requires_manager === 1,
    }));
}

/** Case-insensitive promo-code lookup, mirroring the server's resolveDiscount. */
export function findDiscountByCode(code: string): Discount | null {
  const normalized = code.trim().toUpperCase();
  if (!normalized) return null;
  return (
    getDiscounts().find((d) => d.code?.toUpperCase() === normalized) ?? null
  );
}

export function replaceTables(floorPlans: FloorPlanPayload[]): void {
  db.withTransactionSync(() => {
    db.runSync('DELETE FROM dining_tables');
    for (const plan of floorPlans) {
      for (const table of plan.tables ?? []) {
        db.runSync(
          `INSERT INTO dining_tables(id, floor_plan_id, floor_plan_name, floor_plan_width, floor_plan_height, name, capacity, shape, status, active_order_id, active_order_total, pos_x, pos_y)
           VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            table.id,
            plan.id,
            plan.name,
            plan.width ?? 800,
            plan.height ?? 600,
            table.name,
            table.capacity ?? 4,
            table.shape ?? 'rectangle',
            table.status ?? 'available',
            table.activeOrderId ?? null,
            table.activeOrderTotal ?? 0,
            table.posX ?? 0,
            table.posY ?? 0,
          ],
        );
      }
    }
  });
}

/**
 * Floor map, with locally open tabs overlaid on the server's view.
 *
 * `replaceTables` wipes and repopulates this table from the server on every
 * pull, so occupancy is authoritative but always one sync behind. A tab opened
 * on this register — especially one opened offline — must paint the table
 * immediately, so the local `open_tab` orders win at read time. Nothing is
 * persisted by this merge; the next pull still replaces the server columns.
 */
export function getTables(): DiningTable[] {
  const localTabs = db.getAllSync<{
    id: string;
    table_id: string;
    total_amount: number;
  }>(
    `SELECT id, table_id, total_amount FROM orders
     WHERE status = 'open_tab' AND table_id IS NOT NULL`,
  );
  const tabByTable = new Map(localTabs.map((t) => [t.table_id, t]));

  return db
    .getAllSync<{
      id: string;
      floor_plan_id: string;
      floor_plan_name: string;
      floor_plan_width: number;
      floor_plan_height: number;
      name: string;
      capacity: number;
      shape: string;
      status: string;
      active_order_id: string | null;
      active_order_total: number;
      pos_x: number;
      pos_y: number;
    }>('SELECT * FROM dining_tables ORDER BY name')
    .map((r) => {
      const status: DiningTable['status'] =
        r.status === 'occupied' ? 'occupied'
        : r.status === 'billed' ? 'billed'
        : r.status === 'reserved' ? 'reserved'
        : 'vacant'; // covers 'available' and anything unexpected
      const localTab = tabByTable.get(r.id);
      return {
        id: r.id,
        floorPlanId: r.floor_plan_id,
        floorPlanName: r.floor_plan_name,
        floorPlanWidth: r.floor_plan_width,
        floorPlanHeight: r.floor_plan_height,
        name: r.name,
        capacity: r.capacity,
        shape: r.shape,
        status: localTab ? 'occupied' : status,
        activeOrderId: localTab?.id ?? r.active_order_id ?? null,
        activeOrderTotal: localTab?.total_amount ?? r.active_order_total ?? 0,
        posX: r.pos_x,
        posY: r.pos_y,
      };
    });
}
