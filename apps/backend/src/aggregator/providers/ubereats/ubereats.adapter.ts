import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import {
  MenuProvider,
  NormalizedWebhookEvent,
  OrderProvider,
  WebhookOrderExtractor,
  WebhookProvider,
} from '../../core/interfaces/provider-adapter.interface';
import {
  NormalizedMenu,
  NormalizedOrder,
} from '../../core/models/aggregator.models';
import { ProviderAuthenticationError } from '../../core/errors/aggregator.errors';
import { CredentialEncryptionService } from '../../core/services/credential-encryption.service';
import { AggregatorRepository } from '../../database/aggregator.repository';
import { UberEatsHttpClient } from './ubereats-http.client';
import { UberEatsCredentials, UberEatsWebhookBody } from './ubereats.types';
import { mapOrder, parseWebhook } from './ubereats.mapper';

function fromCents(cents: number): number {
  return Math.round(cents) / 100;
}

/**
 * Direct Uber Eats integration. Differs from KitchenHub in two ways the aggregator
 * already accommodates: webhooks are HMAC-signed (X-Uber-Signature over the raw body,
 * keyed on clientSecret) and notification-only, so orderFromWebhook returns null and
 * the processor fetches the order via getOrder(). Implements the full provider surface.
 */
@Injectable()
export class UberEatsAdapter
  implements OrderProvider, MenuProvider, WebhookProvider, WebhookOrderExtractor
{
  readonly providerName = 'ubereats';
  private readonly logger = new Logger(UberEatsAdapter.name);

  constructor(
    private readonly http: UberEatsHttpClient,
    private readonly encryption: CredentialEncryptionService,
    private readonly repo: AggregatorRepository,
  ) {}

  private async credsFor(connectionId: string): Promise<{
    creds: UberEatsCredentials;
    storeId: string | null;
  }> {
    const account = await this.repo.findIntegrationAccountById(connectionId);
    if (!account || !account.credentials) {
      throw new ProviderAuthenticationError(
        'ubereats',
        `no credentials for integration account ${connectionId}`,
      );
    }
    const creds = this.encryption.decryptJson<UberEatsCredentials>(
      account.credentials as string,
    );
    return { creds, storeId: creds.storeId ?? account.providerStoreId };
  }

  // ── OrderProvider ────────────────────────────────────────────────────────────

  getOrders(connectionId: string): Promise<NormalizedOrder[]> {
    // Uber has no list endpoint in this flow — orders arrive by webhook, then getOrder.
    this.logger.debug(
      `getOrders is a no-op for Uber Eats (connection ${connectionId}); use webhooks + getOrder.`,
    );
    return Promise.resolve([]);
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
    await this.http.acceptOrder(creds, externalOrderId);
  }

  async rejectOrder(
    connectionId: string,
    externalOrderId: string,
    reason?: string,
  ): Promise<void> {
    const { creds } = await this.credsFor(connectionId);
    await this.http.denyOrder(creds, externalOrderId, reason);
  }

  async cancelOrder(
    connectionId: string,
    externalOrderId: string,
    reason?: string,
  ): Promise<void> {
    const { creds } = await this.credsFor(connectionId);
    await this.http.cancelOrder(creds, externalOrderId, reason);
  }

  // ── MenuProvider ─────────────────────────────────────────────────────────────

  async syncMenu(connectionId: string, menu: NormalizedMenu): Promise<void> {
    const { creds, storeId } = await this.credsFor(connectionId);
    if (!storeId) {
      throw new ProviderAuthenticationError(
        'ubereats',
        `integration account ${connectionId} has no store id for menu sync`,
      );
    }
    await this.http.pushMenu(creds, storeId, this.toUberMenu(menu));
  }

  async updateMenu(
    connectionId: string,
    menu: Partial<NormalizedMenu>,
  ): Promise<void> {
    // Uber's menu endpoint is a full replace; treat partial as a full push of what's given.
    await this.syncMenu(connectionId, { categories: menu.categories ?? [] });
  }

  /**
   * NormalizedMenu → Uber Eats menu JSON. Prices go out as decimal dollars. This is a
   * best-effort skeleton; confirm the exact Uber menu schema before enabling menu sync.
   */
  private toUberMenu(menu: NormalizedMenu) {
    return {
      menus: menu.categories.map((cat) => ({
        id: cat.internalCategoryId,
        title: { translations: { en_us: cat.name } },
        items: cat.items.map((item) => ({
          id: item.internalItemId,
          title: { translations: { en_us: item.name } },
          description: { translations: { en_us: item.description ?? '' } },
          price: fromCents(item.price),
        })),
      })),
    };
  }

  // ── WebhookProvider ──────────────────────────────────────────────────────────

  /**
   * Uber signs webhooks with X-Uber-Signature: a lowercase hex HMAC-SHA256 of the raw
   * request body, keyed on the client secret. Verify over the exact received bytes.
   */
  validateWebhook(
    rawBody: string | Buffer,
    headers: Record<string, string>,
    credentials: Record<string, unknown>,
  ): boolean {
    const clientSecret =
      typeof credentials.clientSecret === 'string'
        ? credentials.clientSecret
        : '';
    const provided =
      headers['x-uber-signature'] ?? headers['X-Uber-Signature'] ?? '';
    if (!clientSecret || !provided) return false;

    const expected = crypto
      .createHmac('sha256', clientSecret)
      .update(rawBody)
      .digest('hex');
    const a = Buffer.from(provided.toLowerCase());
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  }

  parseEvent(payload: unknown): NormalizedWebhookEvent {
    return parseWebhook(payload as UberEatsWebhookBody);
  }

  /** Uber webhooks never embed the order — the processor fetches it via getOrder(). */
  orderFromWebhook(): NormalizedOrder | null {
    return null;
  }
}
