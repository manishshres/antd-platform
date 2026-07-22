import { ApiClient, ApiNetworkError, ApiRequestError } from '../api/client';
import { getMeta, setMeta } from '../db/database';
import * as catalogRepo from '../db/catalogRepo';
import * as customersRepo from '../db/customersRepo';
import * as mutationsRepo from '../db/mutationsRepo';
import * as ordersRepo from '../db/ordersRepo';
import type {
  LocalOrder,
  OrderMutation,
  PaymentMethod,
  PosSettings,
} from '../types';

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
      pendingOrders: mutationsRepo.countPendingOrders(),
      failedOrders: mutationsRepo.countFailed(),
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

  /**
   * Recount queue sizes (call after any local order mutation). Counts the
   * outbox, not order statuses — an open tab with unsent appends is still
   * work owed to the server even though the order itself isn't 'pending_sync'.
   */
  refreshCounts(): void {
    this.update({
      pendingOrders: mutationsRepo.countPendingOrders(),
      failedOrders: mutationsRepo.countFailed(),
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
      await this.pushMutations(client, settings);
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

  /**
   * Drain the outbox in global FIFO order. Ordering is the whole point: a tab
   * opened offline queues 'create' then 'append', and the append is only
   * addressable once the create has written back a server id.
   *
   * If any mutation for an order is parked or fails, every later mutation for
   * that same order is skipped this run — replaying an append against an order
   * the server never accepted would just 404, and worse, would let a settle
   * land on a tab that is missing items.
   */
  private async pushMutations(
    client: ApiClient,
    settings: PosSettings,
  ): Promise<void> {
    const blocked = new Set<string>();
    for (const mutation of mutationsRepo.listPending()) {
      if (mutation.lastError) {
        blocked.add(mutation.orderId);
        continue;
      }
      if (blocked.has(mutation.orderId)) continue;

      const order = ordersRepo.getOrderById(mutation.orderId);
      if (!order) {
        // The order was discarded locally; nothing left to say about it.
        mutationsRepo.remove(mutation.id);
        continue;
      }

      try {
        await this.dispatch(client, settings, mutation, order);
        mutationsRepo.remove(mutation.id);
      } catch (err) {
        if (err instanceof ApiRequestError && err.status < 500) {
          // The server understood the request and rejected it (e.g. a menu
          // item was deleted meanwhile). Park it for the operator to review.
          mutationsRepo.markFailed(mutation.id, err.message);
          ordersRepo.markFailed(mutation.orderId, err.message);
          blocked.add(mutation.orderId);
        } else {
          // Network / server hiccup: keep it queued and stop this run —
          // later mutations would almost certainly fail the same way.
          mutationsRepo.bumpAttempts(mutation.id);
          throw err;
        }
      } finally {
        this.refreshCounts();
      }
    }
  }

  private async dispatch(
    client: ApiClient,
    settings: PosSettings,
    mutation: OrderMutation,
    order: LocalOrder,
  ): Promise<void> {
    switch (mutation.kind) {
      case 'create': {
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
          // An open tab has no payment method yet, which is exactly what
          // leaves paidAt null server-side and keeps the table occupied.
          paymentMethod: order.paymentMethod ?? undefined,
          // The server re-resolves and re-prices the discount; our cached
          // copy of the discount table means the local math already agrees.
          discountId: order.discountId ?? undefined,
          tipAmount: order.tipAmount || undefined,
          applyServiceCharge: order.serviceChargeAmount > 0 || undefined,
          redeemPoints: order.loyaltyPointsRedeemed || undefined,
          // 'by_course' tells the server to withhold the kitchen ticket and
          // print course 1 only; the rest wait for explicit fires.
          fireMode: order.fireMode,
          items: order.items.map((i) => ({
            menuItemId: i.menuItemId,
            quantity: i.quantity,
            notes: i.notes,
            course: i.course,
            optionIds: i.modifiers?.map((m) => m.optionId),
            priceOverride: i.priceOverride,
            priceOverrideReason: i.priceOverrideReason,
          })),
        });
        if (order.status === 'open_tab') {
          // Still taking items — record the id but don't close the order out.
          ordersRepo.attachServerId(
            order.id,
            created.id,
            created.ticketNumber ?? null,
          );
        } else {
          ordersRepo.markSynced(
            order.id,
            created.id,
            created.ticketNumber ?? null,
          );
        }
        return;
      }

      case 'append': {
        const serverId = this.requireServerId(order);
        const payload = mutation.payload as {
          items: {
            menuItemId: string;
            quantity: number;
            notes?: string;
            course?: number;
            optionIds?: string[];
            priceOverride?: number;
            priceOverrideReason?: string;
          }[];
        };
        // The mutation id is the idempotency key: replaying it after a
        // dropped response is a no-op server-side.
        await client.appendOrderItems(serverId, {
          clientMutationId: mutation.id,
          items: payload.items,
        });
        return;
      }

      case 'fire': {
        const serverId = this.requireServerId(order);
        const payload = mutation.payload as { course: number };
        await client.fireCourse(serverId, {
          course: payload.course,
          clientMutationId: mutation.id,
        });
        return;
      }

      case 'settle': {
        const serverId = this.requireServerId(order);
        const payload = mutation.payload as {
          paymentMethod: PaymentMethod;
          tipAmount?: number;
        };
        await client.payOrder(serverId, payload);
        ordersRepo.markSynced(order.id, serverId, order.ticketNumber);
        return;
      }
    }
  }

  private requireServerId(order: LocalOrder): string {
    if (!order.serverId) {
      // FIFO should have landed the create first. Treat a gap as transport
      // failure so the work stays queued rather than being parked as rejected.
      throw new ApiNetworkError(
        `Order ${order.id} has no server id yet; its create has not landed.`,
      );
    }
    return order.serverId;
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
