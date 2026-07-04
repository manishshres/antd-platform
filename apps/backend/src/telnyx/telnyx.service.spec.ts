import { Test, TestingModule } from '@nestjs/testing';
import { TelnyxService } from './telnyx.service';
import { ConfigService } from '@nestjs/config';

describe('TelnyxService', () => {
  let service: TelnyxService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TelnyxService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: string) => {
              if (key === 'TELNYX_API_KEY') return 'test-key';
              return defaultValue;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<TelnyxService>(TelnyxService);

    // Mock global fetch
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: 'mock-response' }),
      }),
    ) as jest.Mock;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should call getRecordings with correct headers', async () => {
    await service.getRecordings();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const expectedHeaders: Record<string, string> = expect.objectContaining({
      Authorization: 'Bearer test-key',
    });
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.telnyx.com/v2/recordings',
      expect.objectContaining({
        headers: expectedHeaders,
      }),
    );
  });

  it('should format searchAvailableNumbers correctly', async () => {
    await service.searchAvailableNumbers('US', 'NY', 'New York', 5);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.telnyx.com/v2/available_phone_numbers?filter%5Bcountry_code%5D=US&filter%5Blimit%5D=5&filter%5Badministrative_area%5D=NY&filter%5Blocality%5D=New+York',
      expect.any(Object),
    );
  });

  it('should format createNumberOrder correctly', async () => {
    await service.createNumberOrder('+1234567890');
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.telnyx.com/v2/number_orders',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          phone_numbers: [{ phone_number: '+1234567890' }],
        }),
      }),
    );
  });
});
