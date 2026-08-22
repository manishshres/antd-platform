import {
  INestApplication,
  RequestMethod,
  VersioningType,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { RootController } from './root.controller';

describe('RootController', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [RootController, AppController],
      providers: [
        AppService,
        {
          provide: ConfigService,
          useValue: {
            get: (_key: string, fallback: string) => fallback,
          },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    // Mirror main.ts so the prefix exclusion and version-neutral route are exercised.
    app.setGlobalPrefix('api', {
      exclude: [{ path: '/', method: RequestMethod.GET }],
    });
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers the bare domain with identity and contact details', async () => {
    // Regression: `/` used to 404 because every route sits under the api/v{n} prefix.
    const res = await request(app.getHttpServer()).get('/').expect(200);

    expect(res.body).toMatchObject({
      name: 'Coneeko',
      status: 'ok',
      contact: {
        website: 'https://coneeko.com',
        email: 'hello@coneeko.com',
        support: 'support@coneeko.com',
      },
      endpoints: { health: '/api/v1/health' },
    });
    expect(typeof (res.body as { version: unknown }).version).toBe('string');
  });

  it('leaves the prefixed routes untouched', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/hello')
      .expect(200, 'Hello World!');
  });
});
