import { ApiClient, ApiRequestError } from '../api/client';
import { getMeta, setMeta } from '../db/database';
import * as catalogRepo from '../db/catalogRepo';
import * as customersRepo from '../db/customersRepo';
import * as ordersRepo from '../db/ordersRepo';
import type { PosSettings } from '../types';

export interface SyncState {
  syncing: boolean;
  lastSyncAt: string | null;
  pendingOrders: number;
  failedOrders: number;
  lastError: string | null;
}

type Listener = (state: SyncState) => void;

/**
 * Offline-first synchronizer.
 *
 * Push: locally created customers go up FIRST so that resolveLocalCustomer can
 * repoint any queued order at the canonical server customer id; then the orders
 * (idempotent — the local order id is the server's clientOrderId, so a retry
 * after a dropped response can never double-create).
 * Pull: catalog, customers, tables, locations refresh the SQLite cache.
 *
 * Any network failure simply leaves rows queued; a later run (connectivity
 * regained, interval tick, or manual "Sync now") picks them up again.
 */
export class SyncEngine {
  private listeners = new Set<Listener>();
  private state: SyncState = {
    syncing: false,
    lastSyncAt: null,
    pendingOrders: 0,
    failedOrders: 0,
    lastError: null,
  };

  init(): void {
    this.update({
      lastSyncAt: getMeta('lastSyncAt'),
      pendingOrders: ordersRepo.countOrders('pending_sync'),
      failedOrders: ordersRepo.countOrders('failed'),
    });
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  private update(patch: Partial<SyncState>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l(this.state));
  }

  /** Recount queue sizes (call after any local order mutation). */
  refreshCounts(): void {
    this.update({
      pendingOrders: ordersRepo.countOrders('pending_sync'),
      failedOrders: ordersRepo.countOrders('failed'),
    });
  }

  async syncAll(settings: PosSettings): Promise<void> {
    const client = new ApiClient(settings.apiUrl, settings.apiKey);
    if (!client.isConfigured || this.state.syncing) return;
    this.update({ syncing: true, lastError: null });
    try {
      // Customers first: resolveLocalCustomer repoints queued orders at the
      // server customer id, so orders must be pushed only after that remap (P7-002).
      await this.pushCustomers(client);
      await this.pushOrders(client, settings);
      await this.pullAll(client, settings);
      setMeta('lastSyncAt', new Date().toISOString());
      this.update({ lastSyncAt: getMeta('lastSyncAt') });
    } catch (err) {
      this.update({
        lastError: err instanceof Error ? err.message : 'Sync failed',
      });
    } finally {
      this.refreshCounts();
      this.update({ syncing: false });
    }
  }

  private async pushOrders(
    client: ApiClient,
    settings: PosSettings,
  ): Promise<void> {
    const queue = ordersRepo.listOrders(['pending_sync']);
    for (const order of queue) {
      try {
        const created = await client.createPosOrder({
          locationId: settings.locationId,
          clientOrderId: order.id,
          // Only send ids the server can know about; a customer created
          // offline syncs first, so by the time we get here the order row
          // points at the canonical server id.
          customerId: order.customerId ?? undefined,
          customerName: order.customerName || undefined,
          customerPhone: order.customerPhone || undefined,
          tableId: order.tableId ?? undefined,
          orderType: order.orderType,
          specialInstructions: order.specialInstructions ?? undefined,
          paymentMethod: order.paymentMethod ?? undefined,
          // The server re-resolves and re-prices the discount; our cached
          // copy of the discount table means the local math already agrees.
          discountId: order.discountId ?? undefined,
          items: order.items.map((i) => ({
            menuItemId: i.menuItemId,
            quantity: i.quantity,
            notes: i.notes,
          })),
        });
        ordersRepo.markSynced(
          order.id,
          created.id,
          created.ticketNumber ?? null,
        );
      } catch (err) {
        if (err instanceof ApiRequestError && err.status < 500) {
          // The server understood the request and rejected it (e.g. a menu
          // item was deleted meanwhile). Park it for the operator to review.
          ordersRepo.markFailed(order.id, err.message);
        } else {
          // Network / server hiccup: keep it queued and stop this run —
          // later orders would almost certainly fail the same way.
          throw err;
        }
      } finally {
        this.refreshCounts();
      }
    }
  }

  private async pushCustomers(client: ApiClient): Promise<void> {
    for (const customer of customersRepo.listDirtyCustomers()) {
      const server = await client.upsertCustomer({
        name: customer.name,
        phone: customer.phone ?? undefined,
        email: customer.email ?? undefined,
        notes: customer.notes ?? undefined,
      });
      customersRepo.resolveLocalCustomer(customer.id, server);
    }
  }

  private async pullAll(
    client: ApiClient,
    settings: PosSettings,
  ): Promise<void> {
    const [menu, customers, locations, discounts] = await Promise.all([
      client.getMenu(settings.locationId || undefined),
      client.getCustomers(),
      client.getLocations(),
      client.getDiscounts(),
    ]);
    catalogRepo.replaceCatalog(menu.data ?? []);
    customersRepo.mergeServerCustomers(customers ?? []);
    catalogRepo.replaceLocations(locations ?? []);
    catalogRepo.replaceDiscounts(discounts ?? []);
    if (settings.locationId) {
      const plans = await client.getFloorPlans(settings.locationId);
      catalogRepo.replaceTables(plans ?? []);
    }
  }
}

export const syncEngine = new SyncEngine();
