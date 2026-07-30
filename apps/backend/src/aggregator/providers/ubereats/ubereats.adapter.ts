import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import {
  AcceptOrderOptions,
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
import {
  UberEatsCredentials,
  UberEatsWebhookBody,
  UberPosDataPatchBody,
  UberPosDataResponse,
} from './ubereats.types';
import {
  mapOrder,
  parseWebhook,
  toAcceptBody,
  toCancelBody,
  toDenyBody,
  toPosDataBody,
  toUberMenu,
} from './ubereats.mapper';

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
    options?: AcceptOrderOptions,
  ): Promise<void> {
    const { creds } = await this.credsFor(connectionId);
    await this.http.acceptOrder(
      creds,
      externalOrderId,
      toAcceptBody({ externalReferenceId: options?.externalReferenceId }),
    );
  }

  /** Deny an order Uber is still waiting on (pre-acceptance). */
  async rejectOrder(
    connectionId: string,
    externalOrderId: string,
    reason?: string,
  ): Promise<void> {
    const { creds } = await this.credsFor(connectionId);
    await this.http.denyOrder(creds, externalOrderId, toDenyBody(reason));
  }

  /** Cancel an order we already accepted — a different Uber endpoint *and* reason enum. */
  async cancelOrder(
    connectionId: string,
    externalOrderId: string,
    reason?: string,
  ): Promise<void> {
    const { creds } = await this.credsFor(connectionId);
    await this.http.cancelOrder(creds, externalOrderId, toCancelBody(reason));
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
    await this.http.pushMenu(creds, storeId, toUberMenu(menu));
  }

  async updateMenu(
    connectionId: string,
    menu: Partial<NormalizedMenu>,
  ): Promise<void> {
    // Uber's menu endpoint is a full replace; treat partial as a full push of what's given.
    await this.syncMenu(connectionId, { categories: menu.categories ?? [] });
  }

  // ── Integration configuration (pos_data) ─────────────────────────────────────

  private async storeIdFor(connectionId: string): Promise<{
    creds: UberEatsCredentials;
    storeId: string;
  }> {
    const { creds, storeId } = await this.credsFor(connectionId);
    if (!storeId) {
      throw new ProviderAuthenticationError(
        'ubereats',
        `integration account ${connectionId} has no Uber store id`,
      );
    }
    return { creds, storeId };
  }

  /**
   * Associate this app with a store using the merchant's own OAuth token, then switch order
   * webhooks on with our developer token. Two calls because Uber splits them by grant:
   * `POST /pos_data` needs `eats.pos_provisioning` (merchant), while `integration_enabled`
   * is only settable on `PATCH`, which uses `eats.store` (developer).
   */
  async activateStore(
    connectionId: string,
    merchantAccessToken: string,
    options?: { merchantStoreId?: string },
  ): Promise<UberPosDataResponse> {
    const { storeId } = await this.storeIdFor(connectionId);
    await this.http.activateIntegration(
      merchantAccessToken,
      storeId,
      toPosDataBody({
        integratorStoreId: connectionId,
        merchantStoreId: options?.merchantStoreId,
      }),
    );
    this.logger.log(`Associated Uber store ${storeId} with this app.`);
    return this.enableStoreIntegration(connectionId, options);
  }

  /** Read back the store's integration config as Uber currently has it. */
  async getStoreConfig(connectionId: string): Promise<UberPosDataResponse> {
    const { creds, storeId } = await this.storeIdFor(connectionId);
    return this.http.getPosData(creds, storeId);
  }

  /**
   * Assert our integration config on a store Uber has already associated with this app,
   * and switch order webhooks on. This is the step that takes a provisioned-but-silent
   * store to one that actually delivers `orders.notification`.
   */
  async enableStoreIntegration(
    connectionId: string,
    options?: { merchantStoreId?: string },
  ): Promise<UberPosDataResponse> {
    const { creds, storeId } = await this.storeIdFor(connectionId);
    const body: UberPosDataPatchBody = {
      ...toPosDataBody({
        integratorStoreId: connectionId,
        merchantStoreId: options?.merchantStoreId,
      }),
      integration_enabled: true,
    };
    await this.http.updatePosData(creds, storeId, body);
    this.logger.log(`Enabled Uber Eats integration for store ${storeId}.`);
    return this.http.getPosData(creds, storeId);
  }

  /** Stop order webhooks without removing the app's association with the store. */
  async disableStoreIntegration(connectionId: string): Promise<void> {
    const { creds, storeId } = await this.storeIdFor(connectionId);
    await this.http.updatePosData(creds, storeId, {
      integration_enabled: false,
    });
    this.logger.log(`Disabled Uber Eats integration for store ${storeId}.`);
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
