import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import {
  MenuProvider,
  NormalizedWebhookEvent,
  OrderProvider,
  WebhookProvider,
  WebhookOrderExtractor,
} from '../../core/interfaces/provider-adapter.interface';
import {
  NormalizedMenu,
  NormalizedOrder,
} from '../../core/models/aggregator.models';
import { ProviderAuthenticationError } from '../../core/errors/aggregator.errors';
import { CredentialEncryptionService } from '../../core/services/credential-encryption.service';
import { AggregatorRepository } from '../../database/aggregator.repository';
import { KitchenHubHttpClient } from './kitchenhub-http.client';
import {
  KitchenHubCredentials,
  KitchenHubWebhookBody,
} from './kitchenhub.types';
import {
  extractOrder,
  mapOrder,
  orderExternalId,
  parseWebhook,
} from './kitchenhub.mapper';

function fromCents(cents: number): number {
  return Math.round(cents) / 100;
}

/**
 * KitchenHub is a POS-level aggregator that supports the full surface, so this
 * adapter implements all three provider contracts. It resolves + decrypts an
 * integration account's credentials by connectionId (integration_accounts.id) and
 * delegates transport to KitchenHubHttpClient. Webhook auth is a shared-secret
 * Authorization header (KitchenHub is not HMAC-signed).
 */
@Injectable()
export class KitchenHubAdapter
  implements OrderProvider, MenuProvider, WebhookProvider, WebhookOrderExtractor
{
  readonly providerName = 'kitchenhub';
  private readonly logger = new Logger(KitchenHubAdapter.name);

  constructor(
    private readonly http: KitchenHubHttpClient,
    private readonly encryption: CredentialEncryptionService,
    private readonly repo: AggregatorRepository,
  ) {}

  // ── Credential resolution ────────────────────────────────────────────────────

  private async credsFor(connectionId: string): Promise<{
    creds: KitchenHubCredentials;
    storeId: string | null;
  }> {
    const account = await this.repo.findIntegrationAccountById(connectionId);
    if (!account || !account.credentials) {
      throw new ProviderAuthenticationError(
        'kitchenhub',
        `no credentials for integration account ${connectionId}`,
      );
    }
    const creds = this.encryption.decryptJson<KitchenHubCredentials>(
      account.credentials as string,
    );
    return { creds, storeId: creds.storeId ?? account.providerStoreId };
  }

  /** Public: the configured webhook secret for an account (used by the controller). */
  async webhookSecretFor(connectionId: string): Promise<string | undefined> {
    const { creds } = await this.credsFor(connectionId);
    return creds.webhookSecret;
  }

  // ── OrderProvider ────────────────────────────────────────────────────────────

  async getOrders(
    connectionId: string,
    params?: Record<string, string>,
  ): Promise<NormalizedOrder[]> {
    const { creds } = await this.credsFor(connectionId);
    const orders = await this.http.getOrders(creds, params);
    return orders.map(mapOrder);
  }

  async getOrder(
    connectionId: string,
    externalOrderId: string,
  ): Promise<NormalizedOrder | null> {
    const { creds } = await this.credsFor(connectionId);
    const order = await this.http.getOrder(creds, externalOrderId);
    return order ? mapOrder(order) : null;
  }

  async acceptOrder(
    connectionId: string,
    externalOrderId: string,
  ): Promise<void> {
    const { creds } = await this.credsFor(connectionId);
    await this.http.updateOrderStatus(creds, externalOrderId, 'accept');
  }

  async rejectOrder(
    connectionId: string,
    externalOrderId: string,
    reason?: string,
  ): Promise<void> {
    // KitchenHub has no distinct reject — a not-accepted order is cancelled.
    const { creds } = await this.credsFor(connectionId);
    await this.http.updateOrderStatus(creds, externalOrderId, 'cancel', reason);
  }

  async cancelOrder(
    connectionId: string,
    externalOrderId: string,
    reason?: string,
  ): Promise<void> {
    const { creds } = await this.credsFor(connectionId);
    await this.http.updateOrderStatus(creds, externalOrderId, 'cancel', reason);
  }

  /** Mark an accepted order completed on the marketplace. */
  async completeOrder(
    connectionId: string,
    externalOrderId: string,
  ): Promise<void> {
    const { creds } = await this.credsFor(connectionId);
    await this.http.updateOrderStatus(creds, externalOrderId, 'complete');
  }

  // ── MenuProvider ─────────────────────────────────────────────────────────────

  async syncMenu(connectionId: string, menu: NormalizedMenu): Promise<void> {
    const { creds, storeId } = await this.credsFor(connectionId);
    if (!storeId) {
      throw new ProviderAuthenticationError(
        'kitchenhub',
        `integration account ${connectionId} has no store id for menu sync`,
      );
    }
    await this.http.pushMenu(
      creds,
      storeId,
      this.toKitchenHubMenu(menu),
      false,
    );
  }

  async updateMenu(
    connectionId: string,
    menu: Partial<NormalizedMenu>,
  ): Promise<void> {
    const { creds, storeId } = await this.credsFor(connectionId);
    if (!storeId) {
      throw new ProviderAuthenticationError(
        'kitchenhub',
        `integration account ${connectionId} has no store id for menu sync`,
      );
    }
    await this.http.pushMenu(
      creds,
      storeId,
      this.toKitchenHubMenu({ categories: menu.categories ?? [] }),
      true,
    );
  }

  /**
   * NormalizedMenu → KitchenHub menu JSON. We publish Coneeko ids as the external
   * item ids so inbound order line items map back 1:1 (menu-sync records the mapping).
   * Prices go back out as decimal dollars.
   */
  private toKitchenHubMenu(menu: NormalizedMenu) {
    return {
      categories: menu.categories.map((cat) => ({
        id: cat.internalCategoryId,
        name: cat.name,
        sort_order: cat.sortOrder,
        items: cat.items.map((item) => ({
          id: item.internalItemId,
          name: item.name,
          description: item.description ?? '',
          price: fromCents(item.price),
          image_url: item.imageUrl,
          sort_order: item.sortOrder,
          modifier_groups: item.modifierGroups.map((g) => ({
            id: g.internalModifierGroupId,
            name: g.name,
            required: g.isRequired,
            multi_select: g.multiSelect,
            max_selections: g.maxSelections,
            modifiers: g.modifiers.map((m) => ({
              id: m.internalModifierId,
              name: m.name,
              price: fromCents(m.priceAdjustment),
            })),
          })),
        })),
      })),
    };
  }

  // ── WebhookProvider ──────────────────────────────────────────────────────────

  /**
   * KitchenHub delivers a shared secret in a configured Authorization header rather
   * than an HMAC signature. We accept it from the `authorization` or
   * `x-kitchenhub-signature` header and compare in constant time.
   */
  validateWebhook(
    _rawBody: string | Buffer,
    headers: Record<string, string>,
    credentials: Record<string, unknown>,
  ): boolean {
    const secret =
      typeof credentials.webhookSecret === 'string'
        ? credentials.webhookSecret
        : '';
    if (!secret) return false;
    const provided =
      headers['authorization'] ??
      headers['Authorization'] ??
      headers['x-kitchenhub-signature'] ??
      headers['x-webhook-secret'] ??
      '';
    const normalized = provided.replace(/^Bearer\s+/i, '').trim();
    const a = Buffer.from(normalized);
    const b = Buffer.from(secret);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  }

  parseEvent(payload: unknown): NormalizedWebhookEvent {
    return parseWebhook(payload as KitchenHubWebhookBody);
  }

  orderFromWebhook(payload: unknown): NormalizedOrder | null {
    const order = extractOrder(payload as KitchenHubWebhookBody);
    if (!orderExternalId(order)) return null;
    return mapOrder(order);
  }
}
