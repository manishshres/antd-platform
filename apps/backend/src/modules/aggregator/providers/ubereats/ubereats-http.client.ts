import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ProviderAuthenticationError } from '../../core/errors/aggregator.errors';
import {
  UberEatsCredentials,
  UberEatsTokenResponse,
  UberOrder,
  UberOrderResponse,
} from './ubereats.types';

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

const DEFAULT_API_BASE = 'https://api.uber.com';
const DEFAULT_AUTH_URL = 'https://auth.uber.com/oauth/v2/token';
const DEFAULT_SCOPE = 'eats.order eats.store';
const MAX_RETRIES = 3;

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

  // ── Public API ───────────────────────────────────────────────────────────────

  async getOrder(
    creds: UberEatsCredentials,
    orderId: string,
  ): Promise<UberOrder | null> {
    const res = await this.authedRequest(
      creds,
      'GET',
      `/v2/eats/order/${orderId}`,
    );
    const body = (await this.json(res)) as UberOrderResponse | UberOrder;
    if (!body) return null;
    if ('order' in body && body.order) return body.order;
    return body as UberOrder;
  }

  async acceptOrder(
    creds: UberEatsCredentials,
    orderId: string,
    body?: unknown,
  ): Promise<void> {
    await this.authedRequest(
      creds,
      'POST',
      `/v2/eats/orders/${orderId}/accept_pos_order`,
      body ?? {},
    );
  }

  async denyOrder(
    creds: UberEatsCredentials,
    orderId: string,
    reason?: string,
  ): Promise<void> {
    await this.authedRequest(
      creds,
      'POST',
      `/v2/eats/orders/${orderId}/deny_pos_order`,
      reason ? { reason } : {},
    );
  }

  async cancelOrder(
    creds: UberEatsCredentials,
    orderId: string,
    reason?: string,
  ): Promise<void> {
    await this.authedRequest(
      creds,
      'POST',
      `/v2/eats/orders/${orderId}/cancel`,
      reason ? { reason } : {},
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
      scope: DEFAULT_SCOPE,
    });

    const res = await this.fetchWithRetry(this.authUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    if (!res.ok) {
      throw new ProviderAuthenticationError(
        'ubereats',
        `token request failed (${res.status})`,
      );
    }
    const token = (await this.json(res)) as UberEatsTokenResponse;
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

  private async authedRequest(
    creds: UberEatsCredentials,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Response> {
    let accessToken = await this.ensureToken(creds);
    let res = await this.fetchWithRetry(`${this.apiBase}${path}`, {
      method,
      headers: this.jsonHeaders(accessToken),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (res.status === 401) {
      this.tokenCache.delete(creds.clientId);
      accessToken = await this.authenticate(creds);
      res = await this.fetchWithRetry(`${this.apiBase}${path}`, {
        method,
        headers: this.jsonHeaders(accessToken),
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new ProviderAuthenticationError(
        'ubereats',
        `${method} ${path} failed (${res.status}): ${text.slice(0, 200)}`,
      );
    }
    return res;
  }

  private jsonHeaders(accessToken: string): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    };
  }

  private async fetchWithRetry(
    url: string,
    init: RequestInit,
  ): Promise<Response> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const res = await fetch(url, init);
        if (
          (res.status === 429 || res.status >= 500) &&
          attempt < MAX_RETRIES
        ) {
          await this.sleep(2000 * 2 ** attempt);
          continue;
        }
        return res;
      } catch (err) {
        lastError = err;
        if (attempt < MAX_RETRIES) {
          await this.sleep(2000 * 2 ** attempt);
          continue;
        }
      }
    }
    throw new ProviderAuthenticationError(
      'ubereats',
      `network error calling ${url}: ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`,
    );
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
