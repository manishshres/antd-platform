import { db } from './database';
import { newId } from '../utils/ids';
import type { PrinterStation } from '../types';

interface StationRow {
  id: string;
  name: string;
  enabled: number;
  printer_target: string;
  printer_device_name: string;
  sort_order: number;
}

function toStation(row: StationRow): PrinterStation {
  return {
    id: row.id,
    name: row.name,
    enabled: row.enabled === 1,
    printerTarget: row.printer_target,
    printerDeviceName: row.printer_device_name,
    sortOrder: row.sort_order,
  };
}

export function listStations(): PrinterStation[] {
  return db
    .getAllSync<StationRow>('SELECT * FROM printer_stations ORDER BY sort_order, name')
    .map(toStation);
}

export function getStation(id: string): PrinterStation | null {
  const row = db.getFirstSync<StationRow>('SELECT * FROM printer_stations WHERE id = ?', [id]);
  return row ? toStation(row) : null;
}

export function createStation(input: {
  name: string;
  printerTarget: string;
  printerDeviceName: string;
}): PrinterStation {
  const id = newId();
  const sortOrder = db.getAllSync<{ n: number }>(
    'SELECT COUNT(*) AS n FROM printer_stations',
  )[0]?.n ?? 0;
  db.runSync(
    `INSERT INTO printer_stations(id, name, enabled, printer_target, printer_device_name, sort_order, created_at)
     VALUES(?, ?, 1, ?, ?, ?, ?)`,
    [id, input.name, input.printerTarget, input.printerDeviceName, sortOrder, new Date().toISOString()],
  );
  return {
    id,
    name: input.name,
    enabled: true,
    printerTarget: input.printerTarget,
    printerDeviceName: input.printerDeviceName,
    sortOrder,
  };
}

export function updateStation(
  id: string,
  patch: Partial<Pick<PrinterStation, 'name' | 'enabled' | 'printerTarget' | 'printerDeviceName'>>,
): void {
  const current = getStation(id);
  if (!current) return;
  const next = { ...current, ...patch };
  db.runSync(
    `UPDATE printer_stations
     SET name = ?, enabled = ?, printer_target = ?, printer_device_name = ?
     WHERE id = ?`,
    [next.name, next.enabled ? 1 : 0, next.printerTarget, next.printerDeviceName, id],
  );
}

export function deleteStation(id: string): void {
  // category_stations rows for this station cascade via the FK — categories
  // pointed at a deleted station just fall back to the default printer.
  db.runSync('DELETE FROM printer_stations WHERE id = ?', [id]);
}

export function getCategoryStationMap(): Record<string, string> {
  const rows = db.getAllSync<{ category_id: string; station_id: string }>(
    'SELECT category_id, station_id FROM category_stations',
  );
  const map: Record<string, string> = {};
  for (const r of rows) map[r.category_id] = r.station_id;
  return map;
}

export function setCategoryStation(categoryId: string, stationId: string | null): void {
  if (stationId === null) {
    db.runSync('DELETE FROM category_stations WHERE category_id = ?', [categoryId]);
    return;
  }
  db.runSync(
    `INSERT INTO category_stations(category_id, station_id) VALUES(?, ?)
     ON CONFLICT(category_id) DO UPDATE SET station_id = excluded.station_id`,
    [categoryId, stationId],
  );
}
