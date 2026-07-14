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
          `INSERT INTO products(id, category_id, name, description, price, image_url, is_available, is_favorite, sort_order)
           VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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

export function replaceLocations(locations: Location[]): void {
  db.withTransactionSync(() => {
    db.runSync('DELETE FROM locations');
    for (const loc of locations) {
      db.runSync(
        'INSERT INTO locations(id, name, tax_rate_bps) VALUES(?, ?, ?)',
        [loc.id, loc.name, loc.taxRateBps ?? 0],
      );
    }
  });
}

export function getLocations(): Location[] {
  return db
    .getAllSync<{ id: string; name: string; tax_rate_bps: number }>(
      'SELECT id, name, tax_rate_bps FROM locations ORDER BY name',
    )
    .map((r) => ({ id: r.id, name: r.name, taxRateBps: r.tax_rate_bps }));
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
          `INSERT INTO dining_tables(id, floor_plan_id, floor_plan_name, name, capacity, shape, status, active_order_id, active_order_total)
           VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            table.id,
            plan.id,
            plan.name,
            table.name,
            table.capacity ?? 4,
            table.shape ?? 'rectangle',
            table.status ?? 'available',
            table.activeOrderId ?? null,
            table.activeOrderTotal ?? 0,
          ],
        );
      }
    }
  });
}

export function getTables(): DiningTable[] {
  return db
    .getAllSync<{
      id: string;
      floor_plan_id: string;
      floor_plan_name: string;
      name: string;
      capacity: number;
      shape: string;
      status: string;
      active_order_id: string | null;
      active_order_total: number;
    }>('SELECT * FROM dining_tables ORDER BY name')
    .map((r) => {
      const status: DiningTable['status'] =
        r.status === 'occupied' ? 'occupied'
        : r.status === 'billed' ? 'billed'
        : r.status === 'reserved' ? 'reserved'
        : 'vacant'; // covers 'available' and anything unexpected
      return {
        id: r.id,
        floorPlanId: r.floor_plan_id,
        floorPlanName: r.floor_plan_name,
        name: r.name,
        capacity: r.capacity,
        shape: r.shape,
        status,
        activeOrderId: r.active_order_id ?? null,
        activeOrderTotal: r.active_order_total ?? 0,
      };
    });
}
