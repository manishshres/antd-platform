import { Injectable, Logger } from '@nestjs/common';
import { OrdersService } from '../../../orders/orders.service';
import { AggregatorRepository } from '../../database/aggregator.repository';
import { OrderProcessingError } from '../errors/aggregator.errors';
import { NormalizedOrder } from '../models/aggregator.models';

export interface ImportContext {
  providerId: string;
  providerName: string;
  integrationAccountId: string;
  organizationId: string;
  locationId: string | null;
}

export interface ImportResult {
  externalOrderRowId: string;
  internalOrderId: string | null;
  imported: boolean;
  order?: unknown;
}

/**
 * Turns a provider-agnostic NormalizedOrder into Coneeko's persisted state:
 *   1. external_orders — the raw marketplace record (audit / replay layer)
 *   2. a native Coneeko order + items — via OrdersService.createMarketplaceOrder
 *
 * This service is the seam between the Aggregator and the rest of Coneeko (POS,
 * kitchen, reporting). Provider SDKs never reach past it. Line items must resolve
 * to Coneeko menu items through menu_provider_mappings (the menu is pushed to the
 * provider first); an unmapped item fails the import in a replayable way rather than
 * silently dropping a paid order.
 */
@Injectable()
export class OrderNormalizationService {
  private readonly logger = new Logger(OrderNormalizationService.name);

  constructor(
    private readonly repo: AggregatorRepository,
    private readonly ordersService: OrdersService,
  ) {}

  async importOrder(
    normalized: NormalizedOrder,
    ctx: ImportContext,
  ): Promise<ImportResult> {
    // 1. Persist the raw marketplace order (idempotent on provider + externalOrderId).
    const { row: external } = await this.repo.upsertExternalOrder({
      organizationId: ctx.organizationId,
      locationId: ctx.locationId,
      providerId: ctx.providerId,
      integrationAccountId: ctx.integrationAccountId,
      externalOrderId: normalized.externalOrderId,
      externalStatus: normalized.externalStatus,
      externalCreatedAt: normalized.externalCreatedAt
        ? new Date(normalized.externalCreatedAt)
        : null,
      rawPayload: normalized.rawPayload,
    });

    // Already fully imported — a re-delivered webhook is a no-op.
    if (external.internalOrderId) {
      return {
        externalOrderRowId: external.id,
        internalOrderId: external.internalOrderId,
        imported: false,
      };
    }

    try {
      // 2. Reverse-map each provider line item to a Coneeko menu item.
      const externalItemIds = normalized.items.map((i) => i.externalItemId);
      const itemMap = await this.repo.resolveMenuItemIds(
        ctx.integrationAccountId,
        externalItemIds,
      );
      const unmapped = externalItemIds.filter((id) => !itemMap.has(id));
      if (unmapped.length > 0) {
        throw new OrderProcessingError(
          ctx.providerName,
          normalized.externalOrderId,
          `Unmapped menu items (sync the menu to the provider first): ${unmapped.join(', ')}`,
        );
      }

      // 3. Attribute the order to the underlying marketplace for reporting. A DoorDash
      // order relayed via KitchenHub reports as 'doordash', not 'kitchenhub'; a direct
      // provider (Uber Eats) just uses its own name. Falls back to the transport adapter.
      const sourceName = normalized.sourceChannel ?? ctx.providerName;
      const sourceId = await this.repo.findOrderSourceId(sourceName);

      // 4. Create the native Coneeko order (marketplace prices preserved verbatim).
      const items = normalized.items.map((item) => {
        const menuItemId = itemMap.get(item.externalItemId);
        if (!menuItemId) {
          // Guarded above; keeps the type non-null and guards against drift.
          throw new OrderProcessingError(
            ctx.providerName,
            normalized.externalOrderId,
            `Unmapped menu item ${item.externalItemId}`,
          );
        }
        return {
          menuItemId,
          quantity: item.quantity,
          // NormalizedOrderItem.price is the unit price the customer paid, inclusive
          // of modifier adjustments — matches orders.order_items.price semantics.
          price: item.price,
          modifiers: item.modifiers?.length
            ? item.modifiers.map((m) => ({
                modifier: m.name,
                option: m.name,
                priceAdjustment: m.priceAdjustment,
              }))
            : null,
          notes: item.specialInstructions ?? null,
        };
      });

      const order = await this.ordersService.createMarketplaceOrder({
        organizationId: ctx.organizationId,
        locationId: ctx.locationId,
        source: sourceName,
        sourceId,
        integrationAccountId: ctx.integrationAccountId,
        externalOrderId: normalized.externalOrderId,
        clientOrderId: `${ctx.providerName}:${normalized.externalOrderId}`,
        customerName: normalized.customerInfo?.name ?? 'Marketplace Customer',
        customerPhone: normalized.customerInfo?.phone ?? '',
        orderType: normalized.orderType ?? null,
        specialInstructions: normalized.specialInstructions ?? null,
        subtotal: normalized.subtotal ?? null,
        taxAmount: normalized.taxAmount ?? null,
        tipAmount: normalized.tipAmount ?? null,
        totalAmount: normalized.totalAmount,
        items,
      });

      const internalOrderId = (order as { id: string }).id;
      // 5. Link the raw record to the native order.
      await this.repo.markExternalOrderImported(external.id, internalOrderId);

      this.logger.log(
        `Imported ${ctx.providerName} order ${normalized.externalOrderId} → Coneeko order ${internalOrderId}`,
      );
      return {
        externalOrderRowId: external.id,
        internalOrderId,
        imported: true,
        order,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.repo.markExternalOrderFailed(external.id, message);
      this.logger.error(
        `Failed to import ${ctx.providerName} order ${normalized.externalOrderId}: ${message}`,
      );
      throw err;
    }
  }
}
