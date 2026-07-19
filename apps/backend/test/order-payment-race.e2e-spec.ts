import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import 'dotenv/config';
import { AppModule } from './../src/app.module';
import { DRIZZLE } from '../src/database/database.module';
import * as schema from '../src/database/schema';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, sql } from 'drizzle-orm';
import * as bcrypt from 'bcrypt';
import { OrderPaymentService } from '../src/orders/order-payment.service';
import { OrderPrintService } from '../src/orders/order-print.service';
import { EventsGateway } from '../src/events/events.gateway';
import { TelnyxService } from '../src/telnyx/telnyx.service';
import { MailService } from '../src/common/services/mail.service';

/**
 * Real-Postgres concurrency tests for the advisory-lock financial guards
 * (P2-001 recordPayment, P2-002 refundPaidOrder, P2-006 split detection).
 * These can only be proven against a live database — the lock is a Postgres
 * primitive (`pg_advisory_xact_lock`), so a mocked db can't exercise it.
 */
describe('Order payment concurrency (e2e)', () => {
  let app: INestApplication;
  let db: NodePgDatabase<typeof schema>;
  let paymentService: OrderPaymentService;

  let orgId: string;
  let locationId: string;
  let userId: string;

  const PIN = '4821';

  // A fully-priced order with no payment yet.
  async function seedUnpaidOrder(total: number): Promise<string> {
    const [order] = await db
      .insert(schema.orders)
      .values({
        organizationId: orgId,
        locationId,
        customerName: 'Race Test',
        customerPhone: '+15550000000',
        status: 'confirmed',
        subtotal: total,
        taxAmount: 0,
        totalAmount: total,
      })
      .returning({ id: schema.orders.id });
    return order.id;
  }

  const user = () => ({
    id: userId,
    email: 'race@test.com',
    role: 'manager',
    organizationId: orgId,
  });

  // recordPayment needs a getFullOrder callback; the tests only assert on DB
  // state, so a minimal stub that satisfies the fail-fast lookup is enough.
  const getFullOrder = async (_orgId: string, orderId: string) => {
    const [o] = await db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, orderId))
      .limit(1);
    return o as never;
  };

  const paidSum = async (orderId: string): Promise<number> => {
    const [row] = await db
      .select({
        sum: sql<number>`coalesce(sum(${schema.payments.amount}), 0)`.mapWith(
          Number,
        ),
      })
      .from(schema.payments)
      .where(eq(schema.payments.orderId, orderId));
    return row?.sum ?? 0;
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      // Avoid MQTT/socket side effects — the flows still hit the real DB.
      .overrideProvider(OrderPrintService)
      .useValue({ printForEvents: jest.fn().mockResolvedValue(undefined) })
      .overrideProvider(EventsGateway)
      .useValue({ emitToOrganization: jest.fn() })
      .overrideProvider(TelnyxService)
      .useValue({})
      .overrideProvider(MailService)
      .useValue({})
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    db = app.get<NodePgDatabase<typeof schema>>(DRIZZLE);
    paymentService = app.get(OrderPaymentService);

    const [org] = await db
      .insert(schema.organizations)
      .values({ name: 'Race Org' })
      .returning({ id: schema.organizations.id });
    orgId = org.id;

    const [loc] = await db
      .insert(schema.locations)
      .values({ organizationId: orgId, name: 'HQ', slug: `hq-${Date.now()}` })
      .returning({ id: schema.locations.id });
    locationId = loc.id;

    const [u] = await db
      .insert(schema.users)
      .values({
        email: `race-${Date.now()}@test.com`,
        passwordHash: await bcrypt.hash('pw', 10),
        role: 'manager',
        organizationId: orgId,
        posPinHash: await bcrypt.hash(PIN, 10),
        emailVerifiedAt: new Date(),
      })
      .returning({ id: schema.users.id });
    userId = u.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('P2-001: two concurrent full payments do not overpay', async () => {
    const orderId = await seedUnpaidOrder(1000);

    const results = await Promise.allSettled([
      paymentService.recordPayment(
        user(),
        orderId,
        { method: 'cash' },
        getFullOrder,
      ),
      paymentService.recordPayment(
        user(),
        orderId,
        { method: 'cash' },
        getFullOrder,
      ),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    expect(fulfilled).toHaveLength(1);
    // The loser must be rejected (already paid) — never a silent second charge.
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(await paidSum(orderId)).toBe(1000);
  });

  it('P2-006: concurrent split payments settle exactly and flag split', async () => {
    const orderId = await seedUnpaidOrder(1000);

    const results = await Promise.allSettled([
      paymentService.recordPayment(
        user(),
        orderId,
        { method: 'cash', amount: 500 },
        getFullOrder,
      ),
      paymentService.recordPayment(
        user(),
        orderId,
        { method: 'card', amount: 500 },
        getFullOrder,
      ),
    ]);

    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    expect(await paidSum(orderId)).toBe(1000);

    const [order] = await db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, orderId))
      .limit(1);
    expect(order.paidAt).not.toBeNull();
    expect(order.paymentMethod).toBe('split');
  });

  it('P2-002: two concurrent refunds do not double-refund', async () => {
    const orderId = await seedUnpaidOrder(1000);
    // Pay it in full first so there is a refundable balance.
    await paymentService.recordPayment(
      user(),
      orderId,
      { method: 'cash' },
      getFullOrder,
    );
    expect(await paidSum(orderId)).toBe(1000);

    const results = await Promise.allSettled([
      paymentService.refundPaidOrder(user(), orderId, PIN, 'race'),
      paymentService.refundPaidOrder(user(), orderId, PIN, 'race'),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    // Net of payment + refund rows is zero — not negative (double refund).
    expect(await paidSum(orderId)).toBe(0);

    const [order] = await db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, orderId))
      .limit(1);
    expect(order.status).toBe('cancelled');
  });
});
