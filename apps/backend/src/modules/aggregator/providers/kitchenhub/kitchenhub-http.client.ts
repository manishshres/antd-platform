import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ProviderAuthenticationError } from '../../core/errors/aggregator.errors';
import {
  KitchenHubCredentials,
  KitchenHubOrder,
  KitchenHubTokenResponse,
} from './kitchenhub.types';

interface CachedToken {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch ms
}

const DEFAULT_BASE_URL = 'https://api.kitchenhub.app/v2';
const DEFAULT_TOKEN_TTL_MS = 55 * 60 * 1000; // assume ~1h; refresh a little early
const MAX_RETRIES = 3;

/**
 * Thin fetch wrapper for the KitchenHub v2 API. Owns OAuth2 client-credentials auth
 * (token acquisition + refresh, cached in-memory per clientId) and exponential backoff
 * on 429/5xx. Credentials arrive already-decrypted from the adapter; this client never
 * touches the DB or the encryption service.
 */
@Injectable()
export class KitchenHubHttpClient {
  private readonly logger = new Logger(KitchenHubHttpClient.name);
  private readonly tokenCache = new Map<string, CachedToken>();

  constructor(private readonly configService: ConfigService) {}

  private get baseUrl(): string {
    return (
      this.configService.get<string>('KITCHENHUB_BASE_URL') ?? DEFAULT_BASE_URL
    ).replace(/\/$/, '');
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  async getOrders(
    creds: KitchenHubCredentials,
    params?: Record<string, string>,
  ): Promise<KitchenHubOrder[]> {
    const qs = params ? `?${new URLSearchParams(params).toString()}` : '';
    const res = await this.authedRequest(creds, 'GET', `/orders${qs}`);
    const body = (await this.json(res)) as
      | { orders?: KitchenHubOrder[]; data?: KitchenHubOrder[] }
      | KitchenHubOrder[];
    if (Array.isArray(body)) return body;
    return body.orders ?? body.data ?? [];
  }

  async getOrder(
    creds: KitchenHubCredentials,
    orderId: string,
  ): Promise<KitchenHubOrder | null> {
    const res = await this.authedRequest(creds, 'GET', `/orders/${orderId}`);
    const body = (await this.json(res)) as
      { order?: KitchenHubOrder; data?: KitchenHubOrder } | KitchenHubOrder;
    if (!body) return null;
    if ('order' in body && body.order) return body.order;
    if ('data' in body && body.data) return body.data;
    return body as KitchenHubOrder;
  }

  /** action: 'accept' | 'cancel' | 'complete' (KitchenHub status actions). */
  async updateOrderStatus(
    creds: KitchenHubCredentials,
    orderId: string,
    action: 'accept' | 'cancel' | 'complete',
    reason?: string,
  ): Promise<void> {
    await this.authedRequest(creds, 'PUT', `/orders/${orderId}/status`, {
      status: action,
      ...(reason ? { reason } : {}),
    });
  }

  async pushMenu(
    creds: KitchenHubCredentials,
    storeId: string,
    menu: unknown,
    partial = false,
  ): Promise<void> {
    await this.authedRequest(
      creds,
      partial ? 'PATCH' : 'PUT',
      `/stores/${storeId}/menu`,
      menu,
    );
  }

  /** Testing aid — KitchenHub emits a webhook back to us for the created mock order. */
  async createMockOrder(
    creds: KitchenHubCredentials,
    body: unknown,
  ): Promise<unknown> {
    const res = await this.authedRequest(creds, 'POST', '/mock-order', body);
    return this.json(res);
  }

  // ── Auth ─────────────────────────────────────────────────────────────────────

  private async ensureToken(creds: KitchenHubCredentials): Promise<string> {
    const cached = this.tokenCache.get(creds.clientId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.accessToken;
    }
    if (cached?.refreshToken) {
      try {
        return await this.refresh(creds, cached.refreshToken);
      } catch {
        // Refresh failed — fall through to a full re-auth.
        this.tokenCache.delete(creds.clientId);
      }
    }
    return this.authenticate(creds);
  }

  private async authenticate(creds: KitchenHubCredentials): Promise<string> {
    const res = await this.rawRequest('POST', '/auth/token', {
      body: { client_id: creds.clientId, client_secret: creds.clientSecret },
    });
    if (!res.ok) {
      throw new ProviderAuthenticationError(
        'kitchenhub',
        `token request failed (${res.status})`,
      );
    }
    const token = (await this.json(res)) as KitchenHubTokenResponse;
    this.cacheToken(creds.clientId, token);
    return token.access_token;
  }

  private async refresh(
    creds: KitchenHubCredentials,
    refreshToken: string,
  ): Promise<string> {
    const res = await this.rawRequest('POST', '/auth/token/refresh', {
      body: { refresh_token: refreshToken },
    });
    if (!res.ok) {
      throw new ProviderAuthenticationError(
        'kitchenhub',
        `token refresh failed (${res.status})`,
      );
    }
    const token = (await this.json(res)) as KitchenHubTokenResponse;
    this.cacheToken(creds.clientId, {
      ...token,
      refresh_token: token.refresh_token || refreshToken,
    });
    return token.access_token;
  }

  private cacheToken(clientId: string, token: KitchenHubTokenResponse): void {
    this.tokenCache.set(clientId, {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt:
        Date.now() +
        (token.expires_in ? token.expires_in * 1000 : DEFAULT_TOKEN_TTL_MS) -
        30_000, // refresh 30s early
    });
  }

  // ── Request plumbing ──────────────────────────────────────────────────────────

  private async authedRequest(
    creds: KitchenHubCredentials,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Response> {
    let accessToken = await this.ensureToken(creds);
    let res = await this.rawRequest(method, path, { accessToken, body });

    // One reactive re-auth on 401 (token revoked/expired early).
    if (res.status === 401) {
      this.tokenCache.delete(creds.clientId);
      accessToken = await this.authenticate(creds);
      res = await this.rawRequest(method, path, { accessToken, body });
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new ProviderAuthenticationError(
        'kitchenhub',
        `${method} ${path} failed (${res.status}): ${text.slice(0, 200)}`,
      );
    }
    return res;
  }

  /** Single HTTP call with exponential backoff on 429/5xx. */
  private async rawRequest(
    method: string,
    path: string,
    opts: { accessToken?: string; body?: unknown } = {},
  ): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    let lastError: unknown;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const res = await fetch(url, {
          method,
          headers: {
            'Content-Type': 'application/json',
            ...(opts.accessToken
              ? { Authorization: `Bearer ${opts.accessToken}` }
              : {}),
          },
          body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        });

        if (
          (res.status === 429 || res.status >= 500) &&
          attempt < MAX_RETRIES
        ) {
          await this.sleep(this.backoffMs(attempt));
          continue;
        }
        return res;
      } catch (err) {
        // Network error — retry with backoff.
        lastError = err;
        if (attempt < MAX_RETRIES) {
          await this.sleep(this.backoffMs(attempt));
          continue;
        }
      }
    }
    throw new ProviderAuthenticationError(
      'kitchenhub',
      `network error calling ${method} ${path}: ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`,
    );
  }

  private backoffMs(attempt: number): number {
    return 2000 * 2 ** attempt; // 2s, 4s, 8s
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async json(res: Response): Promise<unknown> {
    const text = await res.text();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      return {};
    }
  }
}
