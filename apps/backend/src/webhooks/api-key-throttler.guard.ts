import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { Request } from 'express';

/**
 * Throttles by the caller's API key rather than the source IP (H3).
 *
 * AI order webhooks all originate from Telnyx's small egress IP pool, so an IP-based limit
 * would throttle every tenant together and drop legitimate orders. Keying on the `x-api-key`
 * header applies the limit per organization. Falls back to IP when no key is present.
 */
@Injectable()
export class ApiKeyThrottlerGuard extends ThrottlerGuard {
  protected getTracker(req: Request): Promise<string> {
    const apiKey = req.headers['x-api-key'];
    if (typeof apiKey === 'string' && apiKey.length > 0) {
      return Promise.resolve(`apikey:${apiKey}`);
    }
    const ip = req.ips?.length ? req.ips[0] : req.ip;
    return Promise.resolve(`ip:${ip ?? 'unknown'}`);
  }
}
