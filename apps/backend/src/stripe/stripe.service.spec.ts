/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment */
import { Test, TestingModule } from '@nestjs/testing';
import { StripeService } from './stripe.service';
import { ConfigService } from '@nestjs/config';

describe('StripeService', () => {
  let service: StripeService;
  let configServiceMock: any;

  beforeEach(() => {
    configServiceMock = {
      get: jest.fn(),
    };
    // Save original NODE_ENV
    process.env.ORIGINAL_NODE_ENV = process.env.NODE_ENV;
  });

  afterEach(() => {
    // Restore original NODE_ENV
    process.env.NODE_ENV = process.env.ORIGINAL_NODE_ENV;
    jest.clearAllMocks();
  });

  it('should initialize with provided STRIPE_API_KEY', async () => {
    configServiceMock.get.mockReturnValue('sk_test_123');

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StripeService,
        { provide: ConfigService, useValue: configServiceMock },
      ],
    }).compile();

    service = module.get<StripeService>(StripeService);
    expect(service).toBeDefined();
    expect(service.client).toBeDefined();
  });

  it('should fallback to sk_test_placeholder in development/test if key missing', async () => {
    configServiceMock.get.mockReturnValue(undefined);
    process.env.NODE_ENV = 'test';

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StripeService,
        { provide: ConfigService, useValue: configServiceMock },
      ],
    }).compile();

    service = module.get<StripeService>(StripeService);
    expect(service).toBeDefined();
  });

  it('should throw error in production if STRIPE_API_KEY is missing', async () => {
    configServiceMock.get.mockReturnValue(undefined);
    process.env.NODE_ENV = 'production';

    await expect(
      Test.createTestingModule({
        providers: [
          StripeService,
          { provide: ConfigService, useValue: configServiceMock },
        ],
      }).compile(),
    ).rejects.toThrow('STRIPE_API_KEY is missing in production environment');
  });

  it('constructEvent should call stripe.webhooks.constructEvent', async () => {
    configServiceMock.get.mockReturnValue('sk_test_123');

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StripeService,
        { provide: ConfigService, useValue: configServiceMock },
      ],
    }).compile();

    service = module.get<StripeService>(StripeService);

    // Mock the SDK's constructEvent
    service.client.webhooks.constructEvent = jest
      .fn()
      .mockReturnValue({ type: 'checkout.session.completed' });

    const result = service.constructEvent(
      Buffer.from('payload'),
      'sig',
      'secret',
    );
    expect(result).toEqual({ type: 'checkout.session.completed' });
    expect(service.client.webhooks.constructEvent).toHaveBeenCalledWith(
      Buffer.from('payload'),
      'sig',
      'secret',
    );
  });
});
