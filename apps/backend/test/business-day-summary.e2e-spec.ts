import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import 'dotenv/config';
import { AppModule } from './../src/app.module';
import { DRIZZLE } from '../src/database/database.module';
import * as schema from '../src/database/schema';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { OrdersService } from '../src/orders/orders.service';
import { TelnyxService } from '../src/telnyx/telnyx.service';
import { MailService } from '../src/common/services/mail.service';
import type { CurrentUserPayload } from '../src/common/decorators/current-user.decorator';

/**
 * End-to-end proof that getTransactionSummary buckets by the LOCATION's business
 * day, not the UTC server day (P2-008). Two paid orders straddle the NY midnight
 * seam; each must land in exactly one NY business day even though both were
 * created on 2026-07-20 in UTC.
 *
 *   Order A: 2026-07-20T03:30Z = 2026-07-19 23:30 America/New_York → business day 07-19
 *   Order B: 2026-07-20T05:00Z = 2026-07-20 01:00 America/New_York → business day 07-20
 *
 * A naive UTC bound for "2026-07-19" ([00:00Z, 23:59Z]) would EXCLUDE order A.
 * The tz-aware bound ([07-19 04:00Z, 07-20 03:59:59.999Z]) includes it.
 */
describe('getTransactionSummary business-day bucketing (e2e)', () => {
  let app: INestApplication;
  let db: NodePgDatabase<typeof schema>;
  let ordersService: OrdersService;

  let orgId: string;
  let locationId: string;

  const user = () =>
    ({
      id: '00000000-0000-0000-0000-000000000000',
      email: 'tz@test.com',
      role: 'manager',
      organizationId: orgId,
    }) as unknown as CurrentUserPayload;

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

    db = app.get<NodePgDatabase<typeof schema>>(DRIZZLE);
    ordersService = app.get(OrdersService);

    const [org] = await db
      .insert(schema.organizations)
      .values({ name: 'TZ Org' })
      .returning({ id: schema.organizations.id });
    orgId = org.id;

    const [loc] = await db
      .insert(schema.locations)
      .values({
        organizationId: orgId,
        name: 'HQ',
        slug: `hq-tz-${Date.now()}`,
        timezone: 'America/New_York',
      })
      .returning({ id: schema.locations.id });
    locationId = loc.id;

    // Order A — late-night NY on 07-19
    await db.insert(schema.orders).values({
      organizationId: orgId,
      locationId,
      customerName: 'A',
      customerPhone: '+15550000001',
      status: 'confirmed',
      subtotal: 1000,
      taxAmount: 0,
      totalAmount: 1000,
      paidAt: new Date('2026-07-20T03:30:00.000Z'),
      createdAt: new Date('2026-07-20T03:30:00.000Z'),
    });
    // Order B — early-morning NY on 07-20
    await db.insert(schema.orders).values({
      organizationId: orgId,
      locationId,
      customerName: 'B',
      customerPhone: '+15550000002',
      status: 'confirmed',
      subtotal: 2000,
      taxAmount: 0,
      totalAmount: 2000,
      paidAt: new Date('2026-07-20T05:00:00.000Z'),
      createdAt: new Date('2026-07-20T05:00:00.000Z'),
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('buckets the late-night order into 07-19, not 07-20', async () => {
    const summary = await ordersService.getTransactionSummary(
      user(),
      locationId,
      '2026-07-19',
      '2026-07-19',
    );
    // Only order A (1000) belongs to the NY business day 07-19.
    expect(summary.salesCount).toBe(1);
    expect(summary.salesTotal).toBe(1000);
  });

  it('buckets the early-morning order into 07-20, not 07-19', async () => {
    const summary = await ordersService.getTransactionSummary(
      user(),
      locationId,
      '2026-07-20',
      '2026-07-20',
    );
    // Only order B (2000) belongs to the NY business day 07-20.
    expect(summary.salesCount).toBe(1);
    expect(summary.salesTotal).toBe(2000);
  });
});
