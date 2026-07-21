import * as crypto from 'crypto';
import { UberEatsAdapter } from './ubereats.adapter';
import { UberEatsHttpClient } from './ubereats-http.client';
import { CredentialEncryptionService } from '../../core/services/credential-encryption.service';
import { AggregatorRepository } from '../../database/aggregator.repository';

describe('UberEatsAdapter', () => {
  const adapter = new UberEatsAdapter(
    {} as UberEatsHttpClient,
    {} as CredentialEncryptionService,
    {} as AggregatorRepository,
  );

  const clientSecret = 'uber-client-secret';
  const rawBody = JSON.stringify({
    event_type: 'orders.notification',
    meta: { resource_id: 'ord-1' },
  });

  function sign(body: string, secret: string): string {
    return crypto.createHmac('sha256', secret).update(body).digest('hex');
  }

  describe('validateWebhook (HMAC X-Uber-Signature)', () => {
    it('accepts a correctly signed body', () => {
      const headers = { 'x-uber-signature': sign(rawBody, clientSecret) };
      expect(adapter.validateWebhook(rawBody, headers, { clientSecret })).toBe(
        true,
      );
    });

    it('rejects a wrong signature', () => {
      const headers = { 'x-uber-signature': sign(rawBody, 'other-secret') };
      expect(adapter.validateWebhook(rawBody, headers, { clientSecret })).toBe(
        false,
      );
    });

    it('rejects when the signature header or secret is missing', () => {
      expect(adapter.validateWebhook(rawBody, {}, { clientSecret })).toBe(
        false,
      );
      expect(
        adapter.validateWebhook(rawBody, { 'x-uber-signature': 'x' }, {}),
      ).toBe(false);
    });
  });

  describe('orderFromWebhook', () => {
    it('always returns null (Uber webhooks are notification-only)', () => {
      expect(adapter.orderFromWebhook()).toBeNull();
    });
  });

  describe('parseEvent', () => {
    it('normalizes an order notification', () => {
      const event = adapter.parseEvent({
        event_id: 'e1',
        event_type: 'orders.notification',
        meta: { resource_id: 'ord-1' },
      });
      expect(event.eventType).toBe('order.created');
      expect(event.externalOrderId).toBe('ord-1');
    });
  });
});
