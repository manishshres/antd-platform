import { Injectable, BadRequestException } from '@nestjs/common';
import {
  canTransitionOrderStatus,
  type OrderStatus,
} from '../../../common/constants/order-status';

/**
 * Coneeko's internal order statuses.
 * Marketplace statuses (DoorDash: NEW → ACCEPTED → PICKED_UP → DELIVERED)
 * live on external_orders.external_status and are mapped here during import.
 *
 * The status set and the transition table are shared with the rest of the platform
 * (`common/constants/order-status.ts`) — this module used to keep its own copy that
 * called the terminal status `delivered` while `orders.service.ts` called it
 * `completed` (N1). Marketplace "delivered"/"picked_up" map onto `completed`.
 */
export type ConeekOrderStatus = OrderStatus;

@Injectable()
export class OrderStatusTransitionService {
  /**
   * Returns true if the transition is allowed.
   */
  canTransition(from: ConeekOrderStatus, to: ConeekOrderStatus): boolean {
    return canTransitionOrderStatus(from, to);
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
      completed: 'completed',
      canceled: 'cancelled',
      cancelled: 'cancelled',
      refunded: 'refunded',
      // DoorDash-style — a delivered/picked-up marketplace order is a completed order here.
      picked_up: 'completed',
      delivered: 'completed',
      // Uber Eats `current_state`: CREATED | ACCEPTED | DENIED | FINISHED | CANCELED.
      created: 'pending',
      denied: 'cancelled',
      finished: 'completed',
    };
    return mapping[normalized] ?? 'pending';
  }
}
