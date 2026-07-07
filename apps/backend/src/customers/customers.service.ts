import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { DRIZZLE } from '../database/database.module';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../database/schema';
import { eq, and, or, ilike, desc, inArray } from 'drizzle-orm';
import { CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { BillingService } from '../billing/billing.service';

@Injectable()
export class CustomersService {
  constructor(
    @Inject(DRIZZLE) private readonly db: NodePgDatabase<typeof schema>,
    private readonly billingService: BillingService,
  ) {}

  async searchCustomers(user: CurrentUserPayload, query: string) {
    const orgId = await this.billingService.getRequiredOrg(user);
    if (!query || query.trim().length < 2) return [];

    const searchQuery = `%${query.trim()}%`;
    return this.db
      .select()
      .from(schema.customers)
      .where(
        and(
          eq(schema.customers.organizationId, orgId),
          or(
            ilike(schema.customers.name, searchQuery),
            ilike(schema.customers.phone, searchQuery),
          ),
        ),
      )
      .limit(10);
  }

  async getCustomerHistory(user: CurrentUserPayload, customerId: string) {
    const orgId = await this.billingService.getRequiredOrg(user);
    
    // First verify customer belongs to org
    const customer = await this.db
      .select()
      .from(schema.customers)
      .where(
        and(
          eq(schema.customers.id, customerId),
          eq(schema.customers.organizationId, orgId),
        ),
      )
      .limit(1);
      
    if (customer.length === 0) {
      throw new NotFoundException('Customer not found');
    }

    const recentOrders = await this.db
      .select()
      .from(schema.orders)
      .where(
        and(
          eq(schema.orders.organizationId, orgId),
          eq(schema.orders.customerId, customerId),
        ),
      )
      .orderBy(desc(schema.orders.createdAt))
      .limit(5);

    // Fetch items for these orders in one query (no per-order round trips)
    const orderIds = recentOrders.map((o) => o.id);
    const items =
      orderIds.length > 0
        ? await this.db
            .select()
            .from(schema.orderItems)
            .where(inArray(schema.orderItems.orderId, orderIds))
        : [];

    return recentOrders.map((order) => ({
      ...order,
      items: items.filter((i) => i.orderId === order.id),
    }));
  }

  async upsertCustomer(
    user: CurrentUserPayload,
    payload: { name: string; phone?: string; email?: string; notes?: string },
  ) {
    const orgId = await this.billingService.getRequiredOrg(user);

    if (payload.phone) {
      const existing = await this.db
        .select()
        .from(schema.customers)
        .where(
          and(
            eq(schema.customers.organizationId, orgId),
            eq(schema.customers.phone, payload.phone),
          ),
        )
        .limit(1);

      if (existing.length > 0) {
        return this.db
          .update(schema.customers)
          .set({
            name: payload.name,
            email: payload.email || existing[0].email,
            notes: payload.notes || existing[0].notes,
            updatedAt: new Date(),
          })
          .where(eq(schema.customers.id, existing[0].id))
          .returning()
          .then((res) => res[0]);
      }
    }

    return this.db
      .insert(schema.customers)
      .values({
        organizationId: orgId,
        name: payload.name,
        phone: payload.phone || null,
        email: payload.email || null,
        notes: payload.notes || null,
      })
      .returning()
      .then((res) => res[0]);
  }
}
