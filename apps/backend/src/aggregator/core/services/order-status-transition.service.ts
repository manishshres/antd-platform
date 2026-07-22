import { Injectable, BadRequestException } from '@nestjs/common';

/**
 * Coneeko's internal order statuses.
 * Marketplace statuses (DoorDash: NEW → ACCEPTED → PICKED_UP → DELIVERED)
 * live on external_orders.external_status and are mapped here during import.
 */
export type ConeekOrderStatus =
  | 'pending'
  | 'confirmed'
  | 'preparing'
  | 'ready'
  | 'delivered'
  | 'cancelled'
  | 'refunded';

/** Allowed Coneeko status transitions. Anything not listed here is illegal. */
const ALLOWED_TRANSITIONS: Record<ConeekOrderStatus, ConeekOrderStatus[]> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['preparing', 'cancelled', 'refunded'],
  preparing: ['ready', 'cancelled'],
  ready: ['delivered', 'cancelled'],
  delivered: ['refunded'],
  cancelled: [], // terminal
  refunded: [], // terminal
};

@Injectable()
export class OrderStatusTransitionService {
  /**
   * Returns true if the transition is allowed.
   */
  canTransition(from: ConeekOrderStatus, to: ConeekOrderStatus): boolean {
    return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
  }

  /**
   * Validates a transition and throws if it is not allowed.
   */
  validateTransition(from: ConeekOrderStatus, to: ConeekOrderStatus): void {
    if (!this.canTransition(from, to)) {
      throw new BadRequestException(
        `Invalid order status transition: ${from} → ${to}`,
      );
    }
  }

  /**
   * Maps a marketplace-specific status string into the closest Coneeko status.
   * Each adapter may override this with provider-specific mappings, but this
   * provides a reasonable default.
   */
  mapExternalStatus(externalStatus: string): ConeekOrderStatus {
    const normalized = externalStatus.toLowerCase().trim();
    const mapping: Record<string, ConeekOrderStatus> = {
      // Generic / KitchenHub
      new: 'pending',
      accepted: 'confirmed',
      confirmed: 'confirmed',
      preparing: 'preparing',
      ready: 'ready',
      completed: 'delivered',
      canceled: 'cancelled',
      cancelled: 'cancelled',
      refunded: 'refunded',
      // DoorDash-style
      picked_up: 'delivered',
      delivered: 'delivered',
    };
    return mapping[normalized] ?? 'pending';
  }
}
