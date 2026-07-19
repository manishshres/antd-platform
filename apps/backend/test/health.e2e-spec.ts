import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import 'dotenv/config';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { TelnyxService } from '../src/telnyx/telnyx.service';
import { MailService } from '../src/common/services/mail.service';

/**
 * The /health endpoint is @Public(). It must report service status but must NOT
 * echo raw DB/Redis error strings to anonymous callers (P10-007 / P10-008) —
 * those can leak table names or internal topology.
 */
describe('Health endpoint (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(TelnyxService)
      .useValue({})
      .overrideProvider(MailService)
      .useValue({})
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health returns service status without leaking error details', async () => {
    const res = await request(app.getHttpServer()).get('/health');

    // Services are up in the test env, so expect a healthy body; either way the
    // shape assertions below are what matter.
    const body = res.body as {
      status: string;
      services: {
        database: Record<string, unknown>;
        redis: Record<string, unknown>;
        mqtt: Record<string, unknown>;
      };
    };

    expect(body.services).toBeDefined();
    // Status is still reported...
    expect(body.services.database.status).toBeDefined();
    expect(body.services.redis.status).toBeDefined();
    // ...but no raw error string is exposed on any service.
    expect(body.services.database).not.toHaveProperty('error');
    expect(body.services.redis).not.toHaveProperty('error');
    // Defensive: no top-level key anywhere in the body is named "error".
    expect(JSON.stringify(body)).not.toContain('"error"');
  });
});
