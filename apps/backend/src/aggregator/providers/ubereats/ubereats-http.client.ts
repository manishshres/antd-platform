import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ProviderAuthenticationError,
  ProviderRequestError,
} from '../../core/errors/aggregator.errors';
import {
  fetchWithRetry,
  parseJsonBody,
} from '../../core/services/http-retry.util';
import {
  UberAcceptOrderBody,
  UberCancelOrderBody,
  UberDenyOrderBody,
  UberEatsCredentials,
  UberEatsTokenResponse,
  UberOrder,
  UberOrderResponse,
  UberPosDataBody,
  UberPosDataPatchBody,
  UberPosDataResponse,
  UberStore,
  UberStoresResponse,
} from './ubereats.types';

/** The only scope the merchant consent flow may ask for. */
const PROVISIONING_SCOPE = 'eats.pos_provisioning';

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

const DEFAULT_API_BASE = 'https://api.uber.com';
const DEFAULT_AUTH_URL = 'https://auth.uber.com/oauth/v2/token';
// Must match exactly what's granted on the Uber developer dashboard's Access Token page
// (POS Ordering app → Access Token → "Scopes Grant Completed") — requesting anything not
// granted 400s the whole token request (invalid_scope), even alongside otherwise-valid
// scopes. Uber's naming here doesn't match their generic docs (no bare "eats.store.status";
// it's "eats.store.status.write" for this app), so verify against the dashboard, not docs,
// before widening this default.
const DEFAULT_SCOPE =
  'eats.order eats.store eats.report eats.store.orders.cancel ' +
  'eats.store.orders.read eats.store.orders.restaurantdelivery.status ' +
  'eats.store.status.write';

/**
 * Thin fetch wrapper for the Uber Eats Marketplace API. Owns OAuth2 client-credentials
 * auth (form-encoded token endpoint, ~30-day tokens cached in-memory per clientId) and
 * exponential backoff on 429/5xx. Credentials arrive already-decrypted from the adapter.
 */
@Injectable()
export class UberEatsHttpClient {
  private readonly logger = new Logger(UberEatsHttpClient.name);
  private readonly tokenCache = new Map<string, CachedToken>();

  constructor(private readonly configService: ConfigService) {}

  private get apiBase(): string {
    return (
      this.configService.get<string>('UBEREATS_BASE_URL') ?? DEFAULT_API_BASE
    ).replace(/\/$/, '');
  }

  private get authUrl(): string {
    return (
      this.configService.get<string>('UBEREATS_AUTH_URL') ?? DEFAULT_AUTH_URL
    );
  }

  private get scope(): string {
    return this.configService.get<string>('UBEREATS_SCOPE') ?? DEFAULT_SCOPE;
  }

  /**
   * Merchant-facing consent page. Derived from the token endpoint by default so pointing
   * `UBEREATS_AUTH_URL` at Uber's sandbox login moves both halves of the flow together.
   */
  private get authorizeUrl(): string {
    const configured =
      this.configService.get<string>('UBEREATS_AUTHORIZE_URL') ?? '';
    return configured || this.authUrl.replace(/\/token$/, '/authorize');
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  /**
   * Fetch an order. `orderRef` is either the webhook's `resource_href` (a full URL that
   * pins the store's API version — preferred) or a bare order id, which we expand to the
   * default order path.
   */
  async getOrder(
    creds: UberEatsCredentials,
    orderRef: string,
  ): Promise<UberOrder | null> {
    const path = orderRef.startsWith('http')
      ? this.toRelativePath(orderRef)
      : `/v2/eats/order/${orderRef}`;
    const res = await this.authedRequest(creds, 'GET', path);
    const body = (await parseJsonBody(res)) as UberOrderResponse | UberOrder;
    if (!body) return null;
    if ('order' in body && body.order) return body.order;
    return body as UberOrder;
  }

  /** Strip a full Uber resource URL down to the path authedRequest joins onto apiBase. */
  private toRelativePath(url: string): string {
    try {
      const parsed = new URL(url);
      return `${parsed.pathname}${parsed.search}`;
    } catch {
      return url;
    }
  }

  /** POST /v1/eats/orders/{id}/accept_pos_order — `reason` is required by Uber. */
  async acceptOrder(
    creds: UberEatsCredentials,
    orderId: string,
    body: UberAcceptOrderBody,
  ): Promise<void> {
    await this.authedRequest(
      creds,
      'POST',
      `/v1/eats/orders/${orderId}/accept_pos_order`,
      body,
    );
  }

  /** POST /v1/eats/orders/{id}/deny_pos_order — pre-acceptance refusal. */
  async denyOrder(
    creds: UberEatsCredentials,
    orderId: string,
    body: UberDenyOrderBody,
  ): Promise<void> {
    await this.authedRequest(
      creds,
      'POST',
      `/v1/eats/orders/${orderId}/deny_pos_order`,
      body,
    );
  }

  /** POST /v1/eats/orders/{id}/cancel — post-acceptance cancellation. */
  async cancelOrder(
    creds: UberEatsCredentials,
    orderId: string,
    body: UberCancelOrderBody,
  ): Promise<void> {
    await this.authedRequest(
      creds,
      'POST',
      `/v1/eats/orders/${orderId}/cancel`,
      body,
    );
  }

  async pushMenu(
    creds: UberEatsCredentials,
    storeId: string,
    menu: unknown,
  ): Promise<void> {
    await this.authedRequest(
      creds,
      'PUT',
      `/v2/eats/stores/${storeId}/menus`,
      menu,
    );
  }

  /**
   * GET /v1/eats/stores — the merchant's stores. Called with the *merchant user* token
   * during onboarding (also allowed with a developer token, `eats.store`), so it takes a
   * raw bearer. Pages via `next_key` until exhausted, capped so a merchant with tens of
   * thousands of stores can't spin here forever.
   */
  async listStores(
    userAccessToken: string,
    maxPages = 20,
  ): Promise<UberStore[]> {
    const stores: UberStore[] = [];
    let startKey: string | undefined;

    for (let page = 0; page < maxPages; page++) {
      const query = new URLSearchParams({ limit: '50' });
      if (startKey) query.set('start_key', startKey);
      const res = await this.bearerRequest(
        userAccessToken,
        'GET',
        `/v1/eats/stores?${query.toString()}`,
      );
      const body = (await parseJsonBody(res)) as UberStoresResponse;
      stores.push(...(body.stores ?? []));
      startKey = body.next_key || undefined;
      if (!startKey) return stores;
    }

    this.logger.warn(
      `Stopped paging Uber stores after ${maxPages} pages (${stores.length} stores).`,
    );
    return stores;
  }

  // ── Integration Activation & Configuration (pos_data) ────────────────────────

  /** GET the store's integration config as Uber currently has it (developer token). */
  async getPosData(
    creds: UberEatsCredentials,
    storeId: string,
  ): Promise<UberPosDataResponse> {
    const res = await this.authedRequest(
      creds,
      'GET',
      `/v1/eats/stores/${storeId}/pos_data`,
    );
    return (await parseJsonBody(res)) as UberPosDataResponse;
  }

  /**
   * PATCH the store's integration config (developer token, `eats.store`). This is how
   * `integration_enabled` — the master switch for order-fulfillment webhooks — and
   * `webhooks_config.webhooks_version` are set on an already-associated store.
   */
  async updatePosData(
    creds: UberEatsCredentials,
    storeId: string,
    body: UberPosDataPatchBody,
  ): Promise<void> {
    await this.authedRequest(
      creds,
      'PATCH',
      `/v1/eats/stores/${storeId}/pos_data`,
      body,
    );
  }

  /**
   * Associate our app with a store. Needs a **merchant user** access token carrying
   * `eats.pos_provisioning` (authorization_code grant, obtained by sending the merchant
   * through Uber's OAuth login) — not our client-credentials developer token, which is
   * why this takes a raw bearer instead of `creds`.
   */
  async activateIntegration(
    userAccessToken: string,
    storeId: string,
    body: UberPosDataBody,
  ): Promise<void> {
    await this.bearerRequest(
      userAccessToken,
      'POST',
      `/v1/eats/stores/${storeId}/pos_data`,
      body,
    );
  }

  /** Remove our app from a store. Also a merchant user token (`eats.pos_provisioning`). */
  async removeIntegration(
    userAccessToken: string,
    storeId: string,
  ): Promise<void> {
    await this.bearerRequest(
      userAccessToken,
      'DELETE',
      `/v1/eats/stores/${storeId}/pos_data`,
    );
  }

  // ── Merchant OAuth (authorization_code) ──────────────────────────────────────

  /**
   * The URL to send a merchant to so they can grant us access to their stores. Uber only
   * honours a `redirect_uri` that is registered on the app's dashboard, and the response
   * comes back to the merchant's browser — `state` is what ties it to an org, so callers
   * must pass an unguessable, single-use value.
   */
  buildAuthorizeUrl(params: {
    clientId: string;
    redirectUri: string;
    state: string;
  }): string {
    const query = new URLSearchParams({
      client_id: params.clientId,
      response_type: 'code',
      scope: PROVISIONING_SCOPE,
      redirect_uri: params.redirectUri,
      state: params.state,
    });
    return `${this.authorizeUrl}?${query.toString()}`;
  }

  /**
   * Exchange the callback's `code` for a merchant user access token. Same token endpoint as
   * client_credentials, different grant — and `redirect_uri` must byte-match the one used
   * on the authorize request or Uber rejects the exchange.
   */
  async exchangeAuthorizationCode(params: {
    clientId: string;
    clientSecret: string;
    code: string;
    redirectUri: string;
  }): Promise<{ accessToken: string; expiresAt: Date; scope?: string }> {
    const form = new URLSearchParams({
      client_id: params.clientId,
      client_secret: params.clientSecret,
      grant_type: 'authorization_code',
      redirect_uri: params.redirectUri,
      code: params.code,
    });

    const res = await fetchWithRetry('ubereats', this.authUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    if (!res.ok) {
      const body = (await parseJsonBody(res)) as {
        error?: string;
        error_description?: string;
      };
      // Never log the code itself — it is a bearer-equivalent secret.
      const detail = body.error ?? `HTTP ${res.status}`;
      throw new ProviderAuthenticationError(
        'ubereats',
        `authorization_code exchange failed (${res.status}): ${detail}`,
      );
    }

    const token = (await parseJsonBody(res)) as UberEatsTokenResponse;
    if (!token.access_token) {
      throw new ProviderAuthenticationError(
        'ubereats',
        'authorization_code exchange returned no access_token',
      );
    }
    return {
      accessToken: token.access_token,
      expiresAt: new Date(
        Date.now() + (token.expires_in ?? 30 * 24 * 60 * 60) * 1000,
      ),
      scope: token.scope,
    };
  }

  // ── Auth ─────────────────────────────────────────────────────────────────────

  private async ensureToken(creds: UberEatsCredentials): Promise<string> {
    const cached = this.tokenCache.get(creds.clientId);
    if (cached && cached.expiresAt > Date.now()) return cached.accessToken;
    return this.authenticate(creds);
  }

  private async authenticate(creds: UberEatsCredentials): Promise<string> {
    const form = new URLSearchParams({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      grant_type: 'client_credentials',
      scope: this.scope,
    });

    const res = await fetchWithRetry('ubereats', this.authUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    if (!res.ok) {
      const body = (await parseJsonBody(res)) as {
        error?: string;
        error_description?: string;
      };
      const detail = body.error
        ? `${body.error}${body.error_description ? `: ${body.error_description}` : ''}`
        : `HTTP ${res.status}`;
      this.logger.warn(`Uber Eats token request failed: ${detail}`);
      throw new ProviderAuthenticationError(
        'ubereats',
        `token request failed (${res.status}): ${detail}`,
      );
    }
    const token = (await parseJsonBody(res)) as UberEatsTokenResponse;
    this.tokenCache.set(creds.clientId, {
      accessToken: token.access_token,
      expiresAt:
        Date.now() +
        (token.expires_in ? token.expires_in * 1000 : 24 * 60 * 60 * 1000) -
        60_000, // refresh a minute early
    });
    return token.access_token;
  }

  // ── Request plumbing ──────────────────────────────────────────────────────────

  /** Developer-token call: authenticates via client_credentials and retries once on 401. */
  private async authedRequest(
    creds: UberEatsCredentials,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Response> {
    const accessToken = await this.ensureToken(creds);
    let res = await this.send(accessToken, method, path, body);

    if (res.status === 401) {
      // Token may have been revoked/rotated ahead of its stated expiry — re-mint once.
      this.tokenCache.delete(creds.clientId);
      res = await this.send(await this.authenticate(creds), method, path, body);
    }

    return this.assertOk(res, method, path);
  }

  /** Call with a caller-supplied bearer (merchant user token for the pos_data grants). */
  private async bearerRequest(
    accessToken: string,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Response> {
    const res = await this.send(accessToken, method, path, body);
    return this.assertOk(res, method, path);
  }

  private send(
    accessToken: string,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Response> {
    return fetchWithRetry('ubereats', `${this.apiBase}${path}`, {
      method,
      headers: this.jsonHeaders(accessToken),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  private async assertOk(
    res: Response,
    method: string,
    path: string,
  ): Promise<Response> {
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const detail = `${method} ${path} failed (${res.status}): ${text.slice(0, 200)}`;
      // A 401 here already survived one re-authentication, so the credentials themselves
      // are the problem. Everything else (403 not-order-manager, 400 bad body, 404 order
      // past its window) is a request-level failure and reads very differently in logs.
      if (res.status === 401) {
        throw new ProviderAuthenticationError('ubereats', detail);
      }
      throw new ProviderRequestError('ubereats', detail, res.status);
    }
    return res;
  }

  private jsonHeaders(accessToken: string): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    };
  }
}
