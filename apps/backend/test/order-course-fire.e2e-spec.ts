import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, BadRequestException } from '@nestjs/common';
import 'dotenv/config';
import { AppModule } from './../src/app.module';
import { DRIZZLE } from '../src/database/database.module';
import * as schema from '../src/database/schema';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import { OrdersService } from '../src/orders/orders.service';
import { PrintJobsService } from '../src/printers/print-jobs.service';
import { EventsGateway } from '../src/events/events.gateway';
import { TelnyxService } from '../src/telnyx/telnyx.service';
import { MailService } from '../src/common/services/mail.service';
import { apiPrincipal } from '../src/public-api/api-principal';

/**
 * Course firing against real Postgres. PrintJobsService is replaced with a spy
 * so the actual tickets can be inspected — the assertions that matter here are
 * about WHAT reaches the kitchen and WHEN, which no amount of DB state proves
 * on its own.
 */
describe('Course firing (e2e)', () => {
  let app: INestApplication;
  let db: NodePgDatabase<typeof schema>;
  let orders: OrdersService;

  let orgId: string;
  let locationId: string;
  let soupId: string; // 600, course 1
  let steakId: string; // 2400, course 2
  let cakeId: string; // 800, course 3

  const createPrintJob = jest.fn().mockResolvedValue({ id: 'job-id' });
  const principal = () => apiPrincipal(orgId);

  /** Kitchen tickets enqueued so far, oldest first. */
  const kitchenTickets = () =>
    createPrintJob.mock.calls
      .map(([opts]: [{ jobType: string; payload: KitchenPayload }]) => opts)
      .filter((o) => o.jobType === 'kitchen')
      .map((o) => o.payload);

  interface KitchenPayload {
    course?: number;
    items: { menuItemName: string; quantity: number; course?: number }[];
  }

  async function itemsOf(orderId: string) {
    return db
      .select({
        menuItemId: schema.orderItems.menuItemId,
        course: schema.orderItems.course,
        firedAt: schema.orderItems.firedAt,
      })
      .from(schema.orderItems)
      .where(eq(schema.orderItems.orderId, orderId));
  }

  /** A three-course dine-in order. */
  async function seedCoursedOrder(fireMode: 'all' | 'by_course') {
    return orders.createPosOrder(principal(), {
      locationId,
      customerName: 'Course Test',
      orderType: 'dine_in',
      fireMode,
      items: [
        { menuItemId: soupId, quantity: 2, course: 1 },
        { menuItemId: steakId, quantity: 2, course: 2 },
        { menuItemId: cakeId, quantity: 1, course: 3 },
      ],
    });
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrintJobsService)
      .useValue({ createPrintJob, listOrderPrintJobs: jest.fn() })
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
    orders = app.get(OrdersService);

    const [org] = await db
      .insert(schema.organizations)
      .values({ name: 'Course Org' })
      .returning({ id: schema.organizations.id });
    orgId = org.id;

    const [loc] = await db
      .insert(schema.locations)
      .values({
        organizationId: orgId,
        name: 'HQ',
        slug: `hq-course-${Date.now()}`,
      })
      .returning({ id: schema.locations.id });
    locationId = loc.id;

    const [cat] = await db
      .insert(schema.categories)
      .values({ organizationId: orgId, locationId, name: 'Menu' })
      .returning({ id: schema.categories.id });

    const seeded = await db
      .insert(schema.menuItems)
      .values([
        { name: 'Soup', price: 600, categoryId: cat.id, locationId },
        { name: 'Steak', price: 2400, categoryId: cat.id, locationId },
        { name: 'Cake', price: 800, categoryId: cat.id, locationId },
      ])
      .returning({ id: schema.menuItems.id, name: schema.menuItems.name });
    soupId = seeded.find((i) => i.name === 'Soup')!.id;
    steakId = seeded.find((i) => i.name === 'Steak')!.id;
    cakeId = seeded.find((i) => i.name === 'Cake')!.id;
  });

  beforeEach(() => createPrintJob.mockClear());

  afterAll(async () => {
    await app.close();
  });

  it('REGRESSION: a fireMode=all order prints one ticket with every item', async () => {
    const order = await seedCoursedOrder('all');

    const tickets = kitchenTickets();
    expect(tickets).toHaveLength(1);
    // No course band, and all three lines on the single ticket — exactly the
    // behaviour every non-dine-in order in the system has always had.
    expect(tickets[0].course).toBeUndefined();
    expect(tickets[0].items).toHaveLength(3);

    // Nothing is marked fired: firedAt is meaningless outside by_course.
    const items = await itemsOf(order.id);
    expect(items.every((i) => i.firedAt === null)).toBe(true);
  });

  it('a by_course order fires course 1 on creation and nothing else', async () => {
    const order = await seedCoursedOrder('by_course');

    const tickets = kitchenTickets();
    expect(tickets).toHaveLength(1);
    expect(tickets[0].course).toBe(1);
    expect(tickets[0].items.map((i) => i.menuItemName)).toEqual(['Soup']);

    const items = await itemsOf(order.id);
    const fired = items.filter((i) => i.firedAt !== null);
    expect(fired).toHaveLength(1);
    expect(fired[0].course).toBe(1);
  });

  it('firing course 2 stamps only course 2 and prints only course 2', async () => {
    const order = await seedCoursedOrder('by_course');
    createPrintJob.mockClear();

    await orders.fireCourse(principal(), order.id, { course: 2 });

    const tickets = kitchenTickets();
    expect(tickets).toHaveLength(1);
    expect(tickets[0].course).toBe(2);
    expect(tickets[0].items.map((i) => i.menuItemName)).toEqual(['Steak']);

    const items = await itemsOf(order.id);
    // Courses 1 and 2 fired; dessert still waiting.
    expect(
      items
        .filter((i) => i.firedAt !== null)
        .map((i) => i.course)
        .sort(),
    ).toEqual([1, 2]);
    expect(items.find((i) => i.course === 3)?.firedAt).toBeNull();
  });

  it('re-firing a course prints nothing the second time', async () => {
    const order = await seedCoursedOrder('by_course');
    await orders.fireCourse(principal(), order.id, { course: 2 });
    const firstFiredAt = (await itemsOf(order.id)).find(
      (i) => i.course === 2,
    )?.firedAt;
    createPrintJob.mockClear();

    // The server taps Fire again, unsure whether the first one took.
    await orders.fireCourse(principal(), order.id, { course: 2 });

    expect(kitchenTickets()).toHaveLength(0);
    // And the original fire time is preserved, not bumped.
    const afterFiredAt = (await itemsOf(order.id)).find(
      (i) => i.course === 2,
    )?.firedAt;
    expect(afterFiredAt).toEqual(firstFiredAt);
  });

  it('a replayed clientMutationId is a no-op', async () => {
    const order = await seedCoursedOrder('by_course');
    const key = `fire-${Date.now()}`;
    await orders.fireCourse(principal(), order.id, {
      course: 2,
      clientMutationId: key,
    });
    createPrintJob.mockClear();

    // The register never saw the response and retried the same mutation.
    await orders.fireCourse(principal(), order.id, {
      course: 2,
      clientMutationId: key,
    });

    expect(kitchenTickets()).toHaveLength(0);
  });

  it('appending to a coursed tab does not print — the items wait to be fired', async () => {
    const order = await seedCoursedOrder('by_course');
    createPrintJob.mockClear();

    await orders.appendOrderItems(principal(), order.id, {
      items: [{ menuItemId: cakeId, quantity: 1, course: 3 }],
    });

    expect(kitchenTickets()).toHaveLength(0);
  });

  it('refuses to fire a paid order', async () => {
    const order = await seedCoursedOrder('by_course');
    await db
      .update(schema.orders)
      .set({ paidAt: new Date(), paymentMethod: 'cash' })
      .where(eq(schema.orders.id, order.id));

    await expect(
      orders.fireCourse(principal(), order.id, { course: 2 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
