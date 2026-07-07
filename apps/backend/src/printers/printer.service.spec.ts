/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { Test, TestingModule } from '@nestjs/testing';
import { PrinterService } from './printer.service';
import { MqttService } from './mqtt.service';

describe('PrinterService', () => {
  let service: PrinterService;

  const mockMqttService = {
    publish: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PrinterService,
        { provide: MqttService, useValue: mockMqttService },
        { provide: 'DRIZZLE', useValue: {} },
      ],
    }).compile();

    service = module.get<PrinterService>(PrinterService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('printCustomerReceipt', () => {
    it('should generate ESC/POS payload and publish to MQTT', async () => {
      // Mock the organization printer config fetch
      jest
        .spyOn(service as any, 'loadOrganizationPrinterConfig')
        .mockResolvedValue({
          name: 'My Org',
          printerTopic: 'printer-123',
        });

      await service.printCustomerReceipt(
        'org-123',
        {
          orderId: 'order-1',
          customerName: 'Alice',
          customerPhone: '555-0100',
          totalAmount: 1500,
          items: [{ menuItemName: 'Burger', quantity: 2, price: 750 }],
          createdAt: new Date(),
        },
        'printer-123',
      );

      expect(mockMqttService.publish).toHaveBeenCalled();
      const args = (mockMqttService.publish.mock.calls as any)[0];
      // Arg 0 is topic, Arg 1 is buffer
      // With a resolvable printer topic, we publish ONLY to it — never also to
      // the broadcast topic. Devices subscribe to both; a dual publish makes the
      // printer print once and Discard the duplicate, failing the job.
      expect(args[0]).toBe('restaurant/org-123/receipt/printer-123');
      expect(mockMqttService.publish).toHaveBeenCalledTimes(1);
      expect(Buffer.isBuffer(args[1])).toBe(true);
    });

    it('should fallback to default topic if no printerId provided', async () => {
      jest
        .spyOn(service as any, 'loadOrganizationPrinterConfig')
        .mockResolvedValue({
          name: 'My Org',
          printerTopic: null,
        });

      await service.printCustomerReceipt('org-123', {
        orderId: 'order-1',
        customerName: 'Alice',
        customerPhone: '555-0100',
        totalAmount: 1500,
        items: [{ menuItemName: 'Burger', quantity: 2, price: 750 }],
        createdAt: new Date(),
      });

      expect(mockMqttService.publish).toHaveBeenCalled();
      const args = (mockMqttService.publish.mock.calls as any)[0];
      expect(args[0]).toBe('restaurant/org-123/receipt/print');
    });
  });
});
