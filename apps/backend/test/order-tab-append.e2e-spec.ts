import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, BadRequestException } from '@nestjs/common';
import 'dotenv/config';
import { AppModule } from './../src/app.module';
import { DRIZZLE } from '../src/database/database.module';
import * as schema from '../src/database/schema';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import { OrdersService } from '../src/orders/orders.service';
import { OrderPrintService } from '../src/orders/order-print.service';
import { EventsGateway } from '../src/events/events.gateway';
import { TelnyxService } from '../src/telnyx/telnyx.service';
import { MailService } from '../src/common/services/mail.service';
import { apiPrincipal } from '../src/public-api/api-principal';
import { TablesService } from '../src/tables/tables.service';

/**
 * Real-Postgres tests for open-tab appends. The whole point of appendOrderItems
 * is that two registers ringing into one tab both survive — that is a property
 * of `pg_advisory_xact_lock`, so it can only be proven against a live database.
 * A mocked db would pass no matter how the concat is written.
 */
describe('Open tab appends (e2e)', () => {
  let app: INestApplication;
  let db: NodePgDatabase<typeof schema>;
  let orders: OrdersService;

  let orgId: string;
  let locationId: string;
  let burgerId: string; // 1000
  let friesId: string; // 400
  let sodaId: string; // 250

  const principal = () => apiPrincipal(orgId);

  /** An open tab: confirmed, unpaid, with one burger on it. */
  async function seedTab(): Promise<string> {
    const [order] = await db
      .insert(schema.orders)
      .values({
        organizationId: orgId,
        locationId,
        customerName: 'Tab Test',
        customerPhone: '+15550000000',
        status: 'confirmed',
        subtotal: 1000,
        taxAmount: 0,
        totalAmount: 1000,
        source: 'pos',
      })
      .returning({ id: schema.orders.id });
    await db.insert(schema.orderItems).values({
      orderId: order.id,
      menuItemId: burgerId,
      quantity: 1,
      price: 1000,
    });
    return order.id;
  }

  async function itemsOf(orderId: string) {
    return db
      .select({
        menuItemId: schema.orderItems.menuItemId,
        quantity: schema.orderItems.quantity,
        price: schema.orderItems.price,
      })
      .from(schema.orderItems)
      .where(eq(schema.orderItems.orderId, orderId));
  }

  async function orderRow(orderId: string) {
    const [o] = await db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, orderId))
      .limit(1);
    return o;
  }

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
    orders = app.get(OrdersService);

    const [org] = await db
      .insert(schema.organizations)
      .values({ name: 'Tab Org' })
      .returning({ id: schema.organizations.id });
    orgId = org.id;

    const [loc] = await db
      .insert(schema.locations)
      .values({
        organizationId: orgId,
        name: 'HQ',
        slug: `hq-tab-${Date.now()}`,
      })
      .returning({ id: schema.locations.id });
    locationId = loc.id;

    const [cat] = await db
      .insert(schema.categories)
      .values({ organizationId: orgId, locationId, name: 'Mains' })
      .returning({ id: schema.categories.id });

    const seeded = await db
      .insert(schema.menuItems)
      .values([
        { name: 'Burger', price: 1000, categoryId: cat.id, locationId },
        { name: 'Fries', price: 400, categoryId: cat.id, locationId },
        { name: 'Soda', price: 250, categoryId: cat.id, locationId },
      ])
      .returning({ id: schema.menuItems.id, name: schema.menuItems.name });
    burgerId = seeded.find((i) => i.name === 'Burger')!.id;
    friesId = seeded.find((i) => i.name === 'Fries')!.id;
    sodaId = seeded.find((i) => i.name === 'Soda')!.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('appends items and re-prices the tab', async () => {
    const orderId = await seedTab();

    await orders.appendOrderItems(principal(), orderId, {
      items: [{ menuItemId: friesId, quantity: 2 }],
    });

    const items = await itemsOf(orderId);
    expect(items).toHaveLength(2);
    // Burger 1000 + 2 × Fries 400 = 1800
    const order = await orderRow(orderId);
    expect(order.subtotal).toBe(1800);
    expect(order.totalAmount).toBe(1800);
  });

  it('THE GATE: two concurrent appends both survive', async () => {
    const orderId = await seedTab();

    // Two registers ringing into the same tab at the same moment. A naive
    // client-side read-concat-write would drop one of these entirely.
    await Promise.all([
      orders.appendOrderItems(principal(), orderId, {
        items: [{ menuItemId: friesId, quantity: 1 }],
      }),
      orders.appendOrderItems(principal(), orderId, {
        items: [{ menuItemId: sodaId, quantity: 1 }],
      }),
    ]);

    const items = await itemsOf(orderId);
    expect(items).toHaveLength(3);
    expect(items.map((i) => i.menuItemId).sort()).toEqual(
      [burgerId, friesId, sodaId].sort(),
    );
    // 1000 + 400 + 250 — neither append clobbered the other's re-price.
    const order = await orderRow(orderId);
    expect(order.subtotal).toBe(1650);
    expect(order.totalAmount).toBe(1650);
  });

  it('replaying a clientMutationId is a no-op', async () => {
    const orderId = await seedTab();
    const key = `mutation-${Date.now()}`;

    await orders.appendOrderItems(principal(), orderId, {
      clientMutationId: key,
      items: [{ menuItemId: friesId, quantity: 1 }],
    });
    // The register never saw the first response and retried the same key.
    await orders.appendOrderItems(principal(), orderId, {
      clientMutationId: key,
      items: [{ menuItemId: friesId, quantity: 1 }],
    });

    const items = await itemsOf(orderId);
    expect(items).toHaveLength(2);
    const order = await orderRow(orderId);
    expect(order.subtotal).toBe(1400);
  });

  it('refuses to append to a paid order', async () => {
    const orderId = await seedTab();
    await db
      .update(schema.orders)
      .set({ paidAt: new Date(), paymentMethod: 'cash' })
      .where(eq(schema.orders.id, orderId));

    await expect(
      orders.appendOrderItems(principal(), orderId, {
        items: [{ menuItemId: friesId, quantity: 1 }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(await itemsOf(orderId)).toHaveLength(1);
  });

  it('refuses to append to a cancelled order', async () => {
    const orderId = await seedTab();
    await db
      .update(schema.orders)
      .set({ status: 'cancelled' })
      .where(eq(schema.orders.id, orderId));

    await expect(
      orders.appendOrderItems(principal(), orderId, {
        items: [{ menuItemId: friesId, quantity: 1 }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('keeps a table occupied while a tab is open and frees it once paid', async () => {
    const [plan] = await db
      .insert(schema.floorPlans)
      .values({ organizationId: orgId, locationId, name: 'Main' })
      .returning({ id: schema.floorPlans.id });
    const [table] = await db
      .insert(schema.tables)
      .values({
        organizationId: orgId,
        floorPlanId: plan.id,
        name: 'T5',
        capacity: 4,
      })
      .returning({ id: schema.tables.id });

    const orderId = await seedTab();
    await db
      .update(schema.orders)
      .set({ tableId: table.id })
      .where(eq(schema.orders.id, orderId));

    const tablesService = app.get(TablesService);

    const before = await tablesService.getFloorPlansWithTables(
      orgId,
      locationId,
    );
    const seatedBefore = before
      .flatMap((p) => p.tables)
      .find((t) => t.id === table.id);
    // A 'confirmed' unpaid tab must read as occupied, not 'billed'.
    expect(seatedBefore?.status).toBe('occupied');

    await db
      .update(schema.orders)
      .set({ paidAt: new Date(), paymentMethod: 'cash' })
      .where(eq(schema.orders.id, orderId));

    const after = await tablesService.getFloorPlansWithTables(
      orgId,
      locationId,
    );
    const seatedAfter = after
      .flatMap((p) => p.tables)
      .find((t) => t.id === table.id);
    expect(seatedAfter?.status).toBe('available');
  });
});
