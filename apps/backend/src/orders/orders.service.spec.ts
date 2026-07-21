/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument */
import { Test, TestingModule } from '@nestjs/testing';
import { OrdersService } from './orders.service';
import { OrderPricingService } from './order-pricing.service';
import { OrderPrintService } from './order-print.service';
import { OrderPaymentService } from './order-payment.service';
import { DRIZZLE } from '../database/database.module';
import { BillingService } from '../billing/billing.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { getQueueToken } from '@nestjs/bullmq';
import { PrintJobsService } from '../printers/print-jobs.service';
import { AuditService } from '../common/services/audit.service';
import { CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EventsGateway } from '../events/events.gateway';
import { UsersService } from '../users/users.service';

const userPayload = (
  overrides: Partial<CurrentUserPayload> = {},
): CurrentUserPayload => ({
  id: 'user-id',
  email: 'user@example.com',
  role: 'manager',
  organizationId: 'org-id',
  locationId: 'loc-1',
  isPlatformAdmin: false,
  ...overrides,
});

const mockEventsGateway = {
  emitToOrganization: jest.fn(),
};

describe('OrdersService', () => {
  let service: OrdersService;

  const mockDb: any = {
    transaction: jest.fn((cb) => cb(mockDb)),
    insert: jest.fn().mockReturnThis(),
    values: jest.fn().mockReturnValue({
      returning: jest.fn().mockResolvedValue([{ id: 'mock-order-id' }]),
    }),
    select: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    innerJoin: jest.fn().mockReturnThis(),
    leftJoin: jest.fn().mockReturnThis(),
    limit: jest.fn().mockResolvedValue([]),
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    returning: jest.fn().mockResolvedValue([{ id: 'mock-order-id' }]),
  };

  const mockBillingService: any = {
    getRequiredOrg: jest.fn().mockResolvedValue('org-id'),
  };

  const mockPrintQueue: any = {
    add: jest.fn(),
  };

  const mockPrintJobsService: any = {
    createPrintJob: jest.fn().mockResolvedValue({ id: 'job-id' }),
    listOrderPrintJobs: jest.fn(),
  };

  const mockAuditService: any = {
    log: jest.fn(),
    fireAndForget: jest.fn(),
  };

  const mockAnalyticsService: any = {
    recordUsage: jest.fn().mockResolvedValue(undefined),
  };

  const mockPricingService: any = {
    priceCartItems: jest.fn().mockResolvedValue({
      resolvedItems: [],
      subtotal: 0,
    }),
    resolveDiscount: jest.fn().mockResolvedValue(null),
    discountAmountFor: jest.fn().mockReturnValue(0),
    resolveOrderLocation: jest.fn().mockResolvedValue('loc-1'),
    nextTicketNumber: jest.fn().mockResolvedValue(1),
    requireOrgCustomer: jest.fn(),
    getTaxRate: jest.fn().mockResolvedValue(0),
  };

  const mockPrintService: any = {
    printForEvents: jest.fn(),
    printOrder: jest.fn(),
    getPrintPlan: jest.fn(),
    buildPrintPayload: jest.fn(),
  };

  const mockPaymentService: any = {
    recordPayment: jest.fn(),
    payOrder: jest.fn(),
    paidSumFor: jest.fn().mockResolvedValue(0),
    refundPaidOrder: jest.fn(),
    refundPartialOrder: jest.fn(),
    adjustOrderItems: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        { provide: DRIZZLE, useValue: mockDb },
        { provide: BillingService, useValue: mockBillingService },
        { provide: AnalyticsService, useValue: mockAnalyticsService },
        { provide: getQueueToken('print-queue'), useValue: mockPrintQueue },
        { provide: PrintJobsService, useValue: mockPrintJobsService },
        { provide: AuditService, useValue: mockAuditService },
        {
          provide: UsersService,
          useValue: { verifyManagerPin: jest.fn(), findOneById: jest.fn() },
        },
        { provide: EventsGateway, useValue: mockEventsGateway },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
        { provide: OrderPricingService, useValue: mockPricingService },
        { provide: OrderPrintService, useValue: mockPrintService },
        { provide: OrderPaymentService, useValue: mockPaymentService },
      ],
    }).compile();

    service = module.get<OrdersService>(OrdersService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('updateOrderStatus', () => {
    it('should throw NotFoundException if order does not exist', async () => {
      mockDb.where.mockResolvedValueOnce([]); // Order not found
      await expect(
        service.updateOrderStatus(userPayload(), 'order-id', 'ready'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException on invalid transition', async () => {
      mockDb.where.mockResolvedValueOnce([{ status: 'completed' }]); // Current status is completed
      await expect(
        service.updateOrderStatus(userPayload(), 'order-id', 'pending'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should allow valid transition', async () => {
      mockDb.where.mockResolvedValueOnce([{ status: 'pending' }]); // Initial get

      // We stub getOrderById for the return call
      jest.spyOn(service, 'getOrderById').mockResolvedValueOnce({} as any);

      await service.updateOrderStatus(userPayload(), 'order-id', 'preparing');

      expect(mockDb.update).toHaveBeenCalled();
      expect(mockAuditService.fireAndForget).toHaveBeenCalled();
    });
  });

  describe('createOrderForOrg', () => {
    it('should throw BadRequestException if order contains no items', async () => {
      await expect(
        service.createOrderForOrg('org-id', 'John', '1234567890', []),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException if menu item does not exist', async () => {
      mockDb.where.mockResolvedValueOnce([]); // db.where returns empty array for menuItems
      await expect(
        service.createOrderForOrg('org-id', 'John', '1234567890', [
          { menuItemId: 'invalid-id', quantity: 1 },
        ]),
      ).rejects.toThrow(NotFoundException);
    });

    it('should create an order successfully, dispatch print jobs, and emit events', async () => {
      const mockMenuItems = [
        { id: 'menu-item-1', price: 1000, locationId: 'loc-1' },
      ];
      mockDb.where.mockResolvedValueOnce(mockMenuItems); // Returns menu item

      const mockOrder = {
        id: 'order-1',
        customerName: 'John',
        customerPhone: '1234567890',
        totalAmount: 1000,
        locationId: 'loc-1',
        createdAt: new Date(),
        items: [
          {
            menuItemId: 'menu-item-1',
            quantity: 1,
            price: 1000,
            menuItemName: 'Burger',
          },
        ],
      };

      // Mock getOrderByIdForOrg which is called at the end
      jest
        .spyOn(service, 'getOrderByIdForOrg')
        .mockResolvedValueOnce(mockOrder as any);

      const result = await service.createOrderForOrg(
        'org-id',
        'John',
        '1234567890',
        [{ menuItemId: 'menu-item-1', quantity: 1 }],
        'user-1',
      );

      expect(result).toBeDefined();
      expect(result.id).toBe('order-1');
      expect(mockDb.transaction).toHaveBeenCalled();
      // Print jobs are now dispatched through OrderPrintService
      expect(mockPrintService.printForEvents).toHaveBeenCalledTimes(1);
      expect(mockAuditService.fireAndForget).toHaveBeenCalled();
      expect(mockAnalyticsService.recordUsage).toHaveBeenCalled();
      expect(mockEventsGateway.emitToOrganization).toHaveBeenCalledWith(
        'org-id',
        'order.created',
        mockOrder,
      );
    });
  });

  describe('getOrderByIdForOrg', () => {
    beforeEach(() => {
      // Reset where to return this by default so we can override it properly
      mockDb.where.mockReturnThis();
      mockDb.limit.mockReset();
    });

    it('should throw NotFoundException if order does not exist', async () => {
      mockDb.limit.mockResolvedValueOnce([]);
      await expect(
        service.getOrderByIdForOrg('org-id', 'invalid-order-id'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should return order with joined items', async () => {
      const mockOrder = { id: 'order-1', customerName: 'John' };
      const mockItems = [{ id: 'item-1', menuItemName: 'Burger' }];

      mockDb.limit.mockResolvedValueOnce([mockOrder]); // Order query terminal
      mockDb.where.mockReturnValueOnce(mockDb); // First query where()
      mockDb.where.mockResolvedValueOnce(mockItems); // Second query where() terminal

      const result = await service.getOrderByIdForOrg('org-id', 'order-1');
      expect(result).toBeDefined();
      expect(result.id).toBe('order-1');
      expect(result.items).toEqual(mockItems);
    });
  });
});
