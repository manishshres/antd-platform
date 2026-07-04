/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { Test, TestingModule } from '@nestjs/testing';
import { HeartbeatService } from './heartbeat.service';
import { DRIZZLE } from '../database/database.module';
import { MqttService } from './mqtt.service';

describe('HeartbeatService', () => {
  let service: HeartbeatService;

  const mockDb: any = {
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    returning: jest.fn().mockResolvedValue([{ id: 'printer-1' }]),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HeartbeatService,
        { provide: DRIZZLE, useValue: mockDb },
        { provide: MqttService, useValue: { publish: jest.fn() } },
      ],
    }).compile();

    service = module.get<HeartbeatService>(HeartbeatService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('handleHeartbeat', () => {
    it('should update printer online status', async () => {
      const topic = 'restaurant/org-1/printer/printer-1/heartbeat';
      const payload = Buffer.from(JSON.stringify({ ip: '127.0.0.1' }));
      await (
        service as unknown as {
          handleHeartbeat: (t: string, p: Buffer) => Promise<void>;
        }
      ).handleHeartbeat(topic, payload);

      expect(mockDb.update).toHaveBeenCalled();
      expect(mockDb.set).toHaveBeenCalledWith(
        expect.objectContaining({
          isOnline: true,
          ipAddress: '127.0.0.1',
          lastHeartbeatAt: expect.any(Date),
        }),
      );
    });
  });

  describe('sweepStalePrinters', () => {
    it('should mark stale printers offline', async () => {
      await service.sweepStalePrinters();
      expect(mockDb.update).toHaveBeenCalled();
      expect(mockDb.set).toHaveBeenCalledWith(
        expect.objectContaining({
          isOnline: false,
        }),
      );
    });
  });
});
