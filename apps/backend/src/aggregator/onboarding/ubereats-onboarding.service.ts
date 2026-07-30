import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { CredentialEncryptionService } from '../core/services/credential-encryption.service';
import { AggregatorRepository } from '../database/aggregator.repository';
import { UberEatsAdapter } from '../providers/ubereats/ubereats.adapter';
import { UberEatsHttpClient } from '../providers/ubereats/ubereats-http.client';
import {
  UberEatsCredentials,
  UberStore,
} from '../providers/ubereats/ubereats.types';
import { ActivateUberStoresDto } from '../dto/ubereats-integration.dto';

const UBEREATS_PROVIDER = 'ubereats';
/** The merchant has this long to finish Uber's consent screen before the state dies. */
const SESSION_TTL_MS = 15 * 60 * 1000;

/** A store as we present it to the merchant for selection. */
export interface DiscoveredStore {
  storeId: string;
  name?: string;
  address?: string;
  merchantStoreId?: string;
  timezone?: string;
  /** True when some app (possibly ours) is already integrated with this store. */
  alreadyIntegrated: boolean;
}

/**
 * Self-serve Uber Eats onboarding: the `authorization_code` half of Uber's auth model.
 *
 * `POST /pos_data` and `GET /stores` require a **merchant user** token, which only exists
 * if the merchant personally signs into Uber and grants our app access — our
 * client-credentials developer token cannot provision a store. So the flow is:
 *
 *   1. `start()`     — mint a single-use `state`, hand back Uber's consent URL.
 *   2. `handleCallback()` — Uber redirects the merchant's browser back with `code` +
 *      `state`; we claim the session by state, exchange the code, and list their stores.
 *   3. `listStores()` — the dashboard shows what we found.
 *   4. `activate()`  — provision the chosen stores (user token), then enable order
 *      webhooks on each (developer token), and wipe the user token.
 *
 * The callback carries no JWT, so `state` is the whole security boundary: 32 random bytes,
 * unique, single-use (claimed by a conditional UPDATE) and expiring in 15 minutes.
 */
@Injectable()
export class UberEatsOnboardingService {
  private readonly logger = new Logger(UberEatsOnboardingService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly http: UberEatsHttpClient,
    private readonly adapter: UberEatsAdapter,
    private readonly encryption: CredentialEncryptionService,
    private readonly repo: AggregatorRepository,
  ) {}

  // ── Configuration ─────────────────────────────────────────────────────────────

  /**
   * Our *app's* Uber credentials — the same pair for every merchant, unlike the per-store
   * rows on integration_accounts. Onboarding needs them before any account exists.
   */
  private appCredentials(): { clientId: string; clientSecret: string } {
    const clientId = this.configService.get<string>('UBEREATS_CLIENT_ID');
    const clientSecret = this.configService.get<string>(
      'UBEREATS_CLIENT_SECRET',
    );
    if (!clientId || !clientSecret) {
      throw new BadRequestException(
        'Uber Eats onboarding is not configured (UBEREATS_CLIENT_ID / UBEREATS_CLIENT_SECRET).',
      );
    }
    return { clientId, clientSecret };
  }

  /** Must byte-match a redirect URI registered on the Uber app dashboard. */
  private redirectUri(): string {
    const explicit = this.configService.get<string>('UBEREATS_REDIRECT_URI');
    if (explicit) return explicit;
    const apiUrl = this.configService.get<string>('PUBLIC_API_URL');
    if (!apiUrl) {
      throw new BadRequestException(
        'Cannot build the Uber redirect URI: set UBEREATS_REDIRECT_URI or PUBLIC_API_URL.',
      );
    }
    return `${apiUrl.replace(/\/$/, '')}/api/v1/aggregator/ubereats/onboarding/callback`;
  }

  // ── 1. Start ──────────────────────────────────────────────────────────────────

  async start(
    orgId: string,
    userId: string | null,
    locationId?: string,
  ): Promise<{ authorizeUrl: string; sessionId: string; expiresAt: Date }> {
    const { clientId } = this.appCredentials();
    const provider = await this.requireProvider();

    const state = randomBytes(32).toString('hex');
    const session = await this.repo.createOauthSession({
      organizationId: orgId,
      userId,
      providerId: provider.id,
      locationId: locationId ?? null,
      state,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    });

    return {
      authorizeUrl: this.http.buildAuthorizeUrl({
        clientId,
        redirectUri: this.redirectUri(),
        state,
      }),
      sessionId: session.id,
      expiresAt: session.expiresAt,
    };
  }

  // ── 2. Callback ───────────────────────────────────────────────────────────────

  /**
   * Handle Uber's redirect. Returns the frontend URL to bounce the merchant's browser to —
   * never an API payload, since a human is looking at this response. Failures are recorded
   * on the session and surfaced as a generic status; the reason stays in our logs.
   */
  async handleCallback(params: {
    code?: string;
    state?: string;
    error?: string;
  }): Promise<string> {
    if (!params.state) {
      this.logger.warn('Uber OAuth callback arrived with no state; ignoring.');
      return this.frontendReturnUrl(null, 'invalid_state');
    }

    // Single-use: this both validates and consumes the state.
    const session = await this.repo.claimOauthSessionByState(params.state);
    if (!session) {
      this.logger.warn(
        'Uber OAuth callback state was unknown, expired, or already used.',
      );
      return this.frontendReturnUrl(null, 'invalid_state');
    }

    if (params.error || !params.code) {
      // The merchant declined, or Uber refused. `params.error` is Uber's own code.
      await this.repo.updateOauthSession(session.id, {
        status: 'failed',
        error: (params.error ?? 'no authorization code returned').slice(
          0,
          1000,
        ),
      });
      return this.frontendReturnUrl(session.id, 'denied');
    }

    try {
      const { clientId, clientSecret } = this.appCredentials();
      const token = await this.http.exchangeAuthorizationCode({
        clientId,
        clientSecret,
        code: params.code,
        redirectUri: this.redirectUri(),
      });

      const stores = await this.http.listStores(token.accessToken);

      await this.repo.updateOauthSession(session.id, {
        status: 'authorized',
        accessToken: this.encryption.encryptJson({
          accessToken: token.accessToken,
        }),
        accessTokenExpiresAt: token.expiresAt,
        discoveredStores: stores,
        error: null,
      });

      this.logger.log(
        `Uber OAuth completed for org ${session.organizationId}: ${stores.length} store(s) discovered.`,
      );
      return this.frontendReturnUrl(session.id, 'ok');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Uber OAuth callback failed: ${message}`);
      await this.repo.updateOauthSession(session.id, {
        status: 'failed',
        error: message.slice(0, 1000),
      });
      return this.frontendReturnUrl(session.id, 'error');
    }
  }

  /**
   * Where to drop the merchant's browser afterwards: the marketplace tab of the dashboard
   * settings page, carrying the session id so the store picker can pick up the handshake.
   */
  private frontendReturnUrl(sessionId: string | null, status: string): string {
    const base = (
      this.configService.get<string>('FRONTEND_URL') ?? 'http://localhost:3000'
    ).replace(/\/$/, '');
    const query = new URLSearchParams({
      tab: 'marketplace-integrations',
      uber_status: status,
    });
    if (sessionId) query.set('uber_session', sessionId);
    return `${base}/settings?${query.toString()}`;
  }

  // ── 3. Review ─────────────────────────────────────────────────────────────────

  async listStores(
    orgId: string,
    sessionId: string,
  ): Promise<{ status: string; stores: DiscoveredStore[] }> {
    const session = await this.ownSession(orgId, sessionId);
    const raw = (session.discoveredStores ?? []) as UberStore[];
    return {
      status: session.status,
      stores: raw
        .filter((store): store is UberStore & { store_id: string } =>
          Boolean(store.store_id),
        )
        .map((store) => ({
          storeId: store.store_id,
          name: store.name,
          address: store.location?.address,
          merchantStoreId: store.merchant_store_id,
          timezone: store.timezone,
          alreadyIntegrated: Boolean(store.pos_data?.integration_enabled),
        })),
    };
  }

  // ── 4. Activate ───────────────────────────────────────────────────────────────

  /**
   * Provision the selected stores. Per store: create the integration account (so we have a
   * stable `integrator_store_id` to send), `POST /pos_data` with the merchant token, then
   * enable order webhooks with the developer token. One store failing doesn't abort the
   * rest — each result is reported back so the dashboard can show partial success.
   */
  async activate(
    orgId: string,
    sessionId: string,
    dto: ActivateUberStoresDto,
  ): Promise<{
    results: {
      storeId: string;
      integrationAccountId?: string;
      activated: boolean;
      error?: string;
    }[];
  }> {
    const session = await this.ownSession(orgId, sessionId);
    if (session.status !== 'authorized') {
      throw new BadRequestException(
        `Onboarding session is ${session.status}; restart the Uber Eats connection.`,
      );
    }
    if (!session.accessToken) {
      throw new BadRequestException(
        'Onboarding session has no merchant authorization; restart the Uber Eats connection.',
      );
    }
    if (
      session.accessTokenExpiresAt &&
      session.accessTokenExpiresAt < new Date()
    ) {
      throw new BadRequestException(
        'The merchant authorization has expired; restart the Uber Eats connection.',
      );
    }

    const { accessToken } = this.encryption.decryptJson<{
      accessToken: string;
    }>(session.accessToken as string);
    const { clientId, clientSecret } = this.appCredentials();
    const provider = await this.requireProvider();
    const known = new Set(
      ((session.discoveredStores ?? []) as UberStore[]).map(
        (store) => store.store_id,
      ),
    );

    const results: {
      storeId: string;
      integrationAccountId?: string;
      activated: boolean;
      error?: string;
    }[] = [];

    for (const selection of dto.stores) {
      // Only stores this merchant actually granted us — never an arbitrary id from the body.
      if (!known.has(selection.storeId)) {
        results.push({
          storeId: selection.storeId,
          activated: false,
          error: 'Store was not part of this authorization.',
        });
        continue;
      }

      let accountId: string | undefined;
      try {
        const credentials: UberEatsCredentials = {
          clientId,
          clientSecret,
          storeId: selection.storeId,
        };
        const account = await this.repo.createIntegrationAccount({
          organizationId: orgId,
          locationId: selection.locationId ?? session.locationId,
          providerId: provider.id,
          credentials: this.encryption.encryptJson(credentials),
          providerStoreId: selection.storeId,
        });
        accountId = account.id;

        await this.adapter.activateStore(accountId, accessToken, {
          merchantStoreId: selection.merchantStoreId,
        });

        results.push({
          storeId: selection.storeId,
          integrationAccountId: accountId,
          activated: true,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(
          `Failed to activate Uber store ${selection.storeId}: ${message}`,
        );
        // Roll the half-made account back so a retry isn't blocked by a dead row.
        if (accountId) await this.repo.deleteIntegrationAccount(accountId);
        results.push({
          storeId: selection.storeId,
          activated: false,
          error: message,
        });
      }
    }

    // The merchant token has served its purpose — drop it rather than keep a 30-day
    // store-provisioning credential lying around.
    await this.repo.updateOauthSession(sessionId, {
      status: 'completed',
      accessToken: null,
      accessTokenExpiresAt: null,
    });

    return { results };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  private async requireProvider() {
    const provider = await this.repo.findProviderByName(UBEREATS_PROVIDER);
    if (!provider) {
      throw new BadRequestException(
        'The ubereats provider row is missing; seed the providers table.',
      );
    }
    return provider;
  }

  private async ownSession(orgId: string, sessionId: string) {
    const session = await this.repo.findOauthSessionById(sessionId);
    if (!session || session.organizationId !== orgId) {
      throw new NotFoundException('Onboarding session not found.');
    }
    return session;
  }
}
