import { Injectable, NotFoundException } from '@nestjs/common';
import {
  MenuProvider,
  OrderProvider,
  WebhookProvider,
  WebhookOrderExtractor,
} from '../interfaces/provider-adapter.interface';
import { KitchenHubAdapter } from '../../providers/kitchenhub/kitchenhub.adapter';
import { UberEatsAdapter } from '../../providers/ubereats/ubereats.adapter';

type AnyAdapter = Partial<
  OrderProvider & MenuProvider & WebhookProvider & WebhookOrderExtractor
> & {
  providerName: string;
};

/**
 * Resolves a provider name (the `:provider` webhook path segment, `orders.source`,
 * etc.) to its adapter, and exposes capability-typed getters. Adding a marketplace is
 * a new adapter registered here — no changes to the webhook pipeline, orders, or POS.
 */
@Injectable()
export class ProviderRegistryService {
  private readonly adapters = new Map<string, AnyAdapter>();

  constructor(kitchenHub: KitchenHubAdapter, uberEats: UberEatsAdapter) {
    // Direct integrations register their own adapter. DoorDash + Grubhub have no direct
    // adapter — they arrive via KitchenHub and are attributed to their marketplace at
    // normalization time (NormalizedOrder.sourceChannel).
    this.register(kitchenHub);
    this.register(uberEats);
  }

  private register(adapter: AnyAdapter): void {
    this.adapters.set(adapter.providerName, adapter);
  }

  has(providerName: string): boolean {
    return this.adapters.has(providerName);
  }

  get(providerName: string): AnyAdapter {
    const adapter = this.adapters.get(providerName);
    if (!adapter) {
      throw new NotFoundException(`Unknown provider: ${providerName}`);
    }
    return adapter;
  }

  getWebhookProvider(providerName: string): WebhookProvider {
    const adapter = this.get(providerName);
    if (
      typeof adapter.validateWebhook !== 'function' ||
      typeof adapter.parseEvent !== 'function'
    ) {
      throw new NotFoundException(
        `Provider ${providerName} does not support webhooks`,
      );
    }
    return adapter as WebhookProvider;
  }

  getOrderProvider(providerName: string): OrderProvider {
    const adapter = this.get(providerName);
    if (
      typeof adapter.acceptOrder !== 'function' ||
      typeof adapter.getOrders !== 'function'
    ) {
      throw new NotFoundException(
        `Provider ${providerName} does not support order operations`,
      );
    }
    return adapter as OrderProvider;
  }

  getMenuProvider(providerName: string): MenuProvider {
    const adapter = this.get(providerName);
    if (typeof adapter.syncMenu !== 'function') {
      throw new NotFoundException(
        `Provider ${providerName} does not support menu sync`,
      );
    }
    return adapter as MenuProvider;
  }

  getOrderExtractor(providerName: string): WebhookOrderExtractor {
    const adapter = this.get(providerName);
    if (typeof adapter.orderFromWebhook !== 'function') {
      throw new NotFoundException(
        `Provider ${providerName} cannot extract orders from webhooks`,
      );
    }
    return adapter as WebhookOrderExtractor;
  }
}
