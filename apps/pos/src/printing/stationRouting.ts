import * as catalogRepo from '../db/catalogRepo';
import * as printerStationsRepo from '../db/printerStationsRepo';
import type { LocalOrderItem, PrinterStation } from '../types';

export interface StationGroup {
  /** null = no station assigned (or its station is disabled) — routes to the register's default printer. */
  station: PrinterStation | null;
  items: LocalOrderItem[];
}

/**
 * Splits an order's items by kitchen station, via each item's menu category.
 * Items whose category has no station assignment, or whose assigned station
 * is disabled, land in a single `station: null` group — the default printer
 * — so registers that haven't configured stations keep printing one ticket.
 */
export function groupItemsByStation(items: LocalOrderItem[]): StationGroup[] {
  const categoryToStation = printerStationsRepo.getCategoryStationMap();
  const stations = new Map(printerStationsRepo.listStations().map((s) => [s.id, s]));

  const groups = new Map<string, StationGroup>();
  const defaultGroup: StationGroup = { station: null, items: [] };
  groups.set('__default__', defaultGroup);

  for (const item of items) {
    const product = catalogRepo.getProductById(item.menuItemId);
    const stationId = product ? categoryToStation[product.categoryId] : undefined;
    const station = stationId ? stations.get(stationId) : undefined;

    if (!station || !station.enabled) {
      defaultGroup.items.push(item);
      continue;
    }

    let group = groups.get(station.id);
    if (!group) {
      group = { station, items: [] };
      groups.set(station.id, group);
    }
    group.items.push(item);
  }

  return Array.from(groups.values()).filter((g) => g.items.length > 0);
}
