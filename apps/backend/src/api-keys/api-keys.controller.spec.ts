import { Test, TestingModule } from '@nestjs/testing';
import { ApiKeysController } from './api-keys.controller';
import { ApiKeysService } from './api-keys.service';

describe('ApiKeysController', () => {
  let controller: ApiKeysController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ApiKeysController],
      providers: [
        {
          provide: ApiKeysService,
          useValue: {
            generateApiKey: jest.fn(),
            getApiKeys: jest.fn(),
            revokeApiKey: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<ApiKeysController>(ApiKeysController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
