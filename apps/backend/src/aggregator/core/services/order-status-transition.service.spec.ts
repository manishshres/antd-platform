import { BadRequestException } from '@nestjs/common';
import { OrderStatusTransitionService } from './order-status-transition.service';

describe('OrderStatusTransitionService', () => {
  const service = new OrderStatusTransitionService();

  describe('canTransition', () => {
    it('allows the forward lifecycle', () => {
      expect(service.canTransition('pending', 'confirmed')).toBe(true);
      expect(service.canTransition('confirmed', 'preparing')).toBe(true);
      expect(service.canTransition('preparing', 'ready')).toBe(true);
      expect(service.canTransition('ready', 'completed')).toBe(true);
      expect(service.canTransition('completed', 'refunded')).toBe(true);
    });

    it('rejects illegal / backward transitions and terminal states', () => {
      expect(service.canTransition('pending', 'completed')).toBe(false);
      expect(service.canTransition('completed', 'pending')).toBe(false);
      expect(service.canTransition('cancelled', 'pending')).toBe(false);
      expect(service.canTransition('refunded', 'confirmed')).toBe(false);
    });
  });

  describe('validateTransition', () => {
    it('throws on an illegal transition', () => {
      expect(() => service.validateTransition('completed', 'pending')).toThrow(
        BadRequestException,
      );
    });

    it('does not throw on a legal transition', () => {
      expect(() =>
        service.validateTransition('pending', 'cancelled'),
      ).not.toThrow();
    });
  });

  describe('mapExternalStatus', () => {
    it('maps generic/KitchenHub statuses', () => {
      expect(service.mapExternalStatus('new')).toBe('pending');
      expect(service.mapExternalStatus('accepted')).toBe('confirmed');
      expect(service.mapExternalStatus('completed')).toBe('completed');
      expect(service.mapExternalStatus('canceled')).toBe('cancelled');
      expect(service.mapExternalStatus('REFUNDED')).toBe('refunded');
    });

    it('maps DoorDash-style statuses and defaults unknowns to pending', () => {
      expect(service.mapExternalStatus('picked_up')).toBe('completed');
      expect(service.mapExternalStatus('mystery')).toBe('pending');
    });
  });
});
