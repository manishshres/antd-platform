export class AggregatorError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: any,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class ProviderAuthenticationError extends AggregatorError {
  constructor(
    provider: string,
    message: string = 'Provider authentication failed',
    details?: any,
  ) {
    super(`[${provider}] ${message}`, 'PROVIDER_AUTH_ERROR', details);
  }
}

/**
 * A provider API call came back non-2xx for a reason other than authentication — a
 * rejected body, a store we aren't the order manager for, an order past its window.
 * Carries the HTTP status so callers can tell "retry this" from "this will never work".
 */
export class ProviderRequestError extends AggregatorError {
  constructor(
    provider: string,
    message: string,
    public readonly status?: number,
    details?: any,
  ) {
    super(`[${provider}] ${message}`, 'PROVIDER_REQUEST_ERROR', details);
  }
}

export class WebhookSignatureInvalidError extends AggregatorError {
  constructor(
    provider: string,
    message: string = 'Webhook signature is invalid',
  ) {
    super(`[${provider}] ${message}`, 'WEBHOOK_SIGNATURE_INVALID');
  }
}

export class OrderProcessingError extends AggregatorError {
  constructor(
    provider: string,
    orderId: string,
    message: string,
    details?: any,
  ) {
    super(
      `[${provider}] Order ${orderId}: ${message}`,
      'ORDER_PROCESSING_ERROR',
      details,
    );
  }
}

export class MenuSyncError extends AggregatorError {
  constructor(
    provider: string,
    storeId: string,
    message: string,
    details?: any,
  ) {
    super(
      `[${provider}] Menu sync for store ${storeId}: ${message}`,
      'MENU_SYNC_ERROR',
      details,
    );
  }
}
