import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import 'dotenv/config';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { TelnyxService } from '../src/telnyx/telnyx.service';
import { MailService } from '../src/common/services/mail.service';
import { DRIZZLE } from '../src/database/database.module';
import * as schema from '../src/database/schema';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { users } from '../src/database/schema';
import * as bcrypt from 'bcrypt';

describe('Provisioning (e2e)', () => {
  let app: INestApplication<App>;
  let jwtToken: string;
  let organizationId: string;

  const mockTelnyxService = {
    searchAvailableNumbers: jest
      .fn()
      .mockResolvedValue([{ phone_number: '+1234567890' }]),
    createNumberOrder: jest.fn().mockResolvedValue({ id: 'order-1' }),
    deletePhoneNumber: jest.fn().mockResolvedValue({}),
    deleteAssistant: jest.fn().mockResolvedValue({}),
  };

  const mockMailService = {
    sendOrganizationInvitation: jest.fn().mockResolvedValue(true),
  };

  console.log('REDIS_URL before tests:', process.env.REDIS_URL);

  beforeAll(async () => {
    // Process env is already modified by globalSetup to point to antd_test
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(TelnyxService)
      .useValue(mockTelnyxService)
      .overrideProvider(MailService)
      .useValue(mockMailService)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('/api/v1/auth/login (POST) - Setup Platform Admin', async () => {
    // Usually you'd seed a platform admin, but for this test we'll create one via a back-door or mock
    // Wait, the system doesn't have a backdoor. We'll use the public register for testing if allowed,
    // or insert a user into the DB directly using drizzle.

    // For simplicity, let's inject DRIZZLE and create an admin user
    const db = app.get<NodePgDatabase<typeof schema>>(DRIZZLE);
    const passHash = await bcrypt.hash('password123', 10);

    await db
      .insert(users)
      .values({
        email: 'platformadmin@test.com',
        passwordHash: passHash,
        role: 'platform_admin',
        firstName: 'Admin',
        lastName: 'User',
        emailVerifiedAt: new Date(),
      })
      .returning();

    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'platformadmin@test.com', password: 'password123' })
      .expect(200);

    const body = response.body as { access_token: string };
    jwtToken = body.access_token;
    expect(jwtToken).toBeDefined();
  });

  it('/api/v1/admin/organizations (POST) - Trigger Provisioning', async () => {
    const response = await request(app.getHttpServer())
      .post('/admin/organizations')
      .set('Authorization', `Bearer ${jwtToken}`)
      .send({
        orgName: 'E2E Test Org',
        locationName: 'HQ',
        adminEmail: 'orgadmin@test.com',
        country: 'US',
        state: 'NY',
        city: 'New York',
      })
      .expect(202);

    const body = response.body as { message: string; organizationId: string };
    expect(body.message).toBe('Provisioning started');
    expect(body.organizationId).toBeDefined();

    organizationId = body.organizationId;
  });

  it('/api/v1/admin/organizations/:id/provisioning-status (GET) - Check Status', async () => {
    const response = await request(app.getHttpServer())
      .get(`/admin/organizations/${organizationId}/provisioning-status`)
      .set('Authorization', `Bearer ${jwtToken}`)
      .expect(200);

    const body = response.body as {
      organizationStatus: string;
      steps: unknown[];
    };
    expect(body.organizationStatus).toBe('provisioning');
    // Provisioning flow is 8 steps (search/purchase phone, clone/assign/configure
    // agent, import menu, register webhook, send admin invitation).
    expect(body.steps).toHaveLength(8);
  });

  it('/api/v1/admin/organizations/:id/status (PATCH) - Suspend Org', async () => {
    const response = await request(app.getHttpServer())
      .patch(`/admin/organizations/${organizationId}/status`)
      .set('Authorization', `Bearer ${jwtToken}`)
      .send({ status: 'suspended' })
      .expect(200);

    const body = response.body as { message: string };
    expect(body.message).toBe('Organization status set to suspended.');
  });

  it('/api/v1/admin/organizations/:id/deprovision (POST) - Deprovision', async () => {
    const response = await request(app.getHttpServer())
      .post(`/admin/organizations/${organizationId}/deprovision`)
      .set('Authorization', `Bearer ${jwtToken}`)
      .expect(200);

    const body = response.body as { message: string };
    expect(body.message).toBe('Organization deprovisioned and archived.');
    expect(mockTelnyxService.deleteAssistant).not.toHaveBeenCalled(); // since we mocked queue, provision didn't set IDs
  });
});
