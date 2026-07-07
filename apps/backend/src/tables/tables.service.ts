import { Injectable, Inject } from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../database/schema';
import { eq, and } from 'drizzle-orm';
import { CreateFloorPlanDto } from './dto/create-floor-plan.dto';
import { CreateTableDto } from './dto/create-table.dto';

@Injectable()
export class TablesService {
  constructor(
    @Inject('DB') private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  async createFloorPlan(orgId: string, dto: CreateFloorPlanDto) {
    const [floorPlan] = await this.db
      .insert(schema.floorPlans)
      .values({
        organizationId: orgId,
        locationId: dto.locationId,
        name: dto.name,
        width: dto.width,
        height: dto.height,
      })
      .returning();
    return floorPlan;
  }

  async createTable(orgId: string, dto: CreateTableDto) {
    const [table] = await this.db
      .insert(schema.tables)
      .values({
        organizationId: orgId,
        floorPlanId: dto.floorPlanId,
        name: dto.name,
        capacity: dto.capacity,
        posX: dto.posX,
        posY: dto.posY,
        shape: dto.shape,
      })
      .returning();
    return table;
  }

  async getFloorPlansWithTables(orgId: string, locationId: string) {
    // Get all floor plans
    const floorPlans = await this.db
      .select()
      .from(schema.floorPlans)
      .where(
        and(
          eq(schema.floorPlans.organizationId, orgId),
          eq(schema.floorPlans.locationId, locationId),
        ),
      );

    const floorPlanIds = floorPlans.map((fp) => fp.id);
    if (!floorPlanIds.length) {
      return [];
    }

    // Get all tables for these floor plans
    const tables = await this.db.query.tables.findMany({
      where: (t, { inArray }) => inArray(t.floorPlanId, floorPlanIds),
    });

    // Get active orders for these tables to determine status
    const tableIds = tables.map((t) => t.id);
    const activeOrders = tableIds.length > 0 ? await this.db.query.orders.findMany({
      where: (o, { inArray, and, notInArray }) => 
        and(
          inArray(o.tableId, tableIds),
          notInArray(o.status, ['completed', 'cancelled', 'refunded', 'voided'])
        )
    }) : [];

    // Group tables by floor plan
    const result = floorPlans.map((fp) => {
      const fpTables = tables.filter((t) => t.floorPlanId === fp.id);
      
      const tablesWithStatus = fpTables.map(t => {
        const order = activeOrders.find(o => o.tableId === t.id);
        return {
          ...t,
          status: order ? (order.status === 'pending' ? 'occupied' : 'billed') : 'available',
          activeOrderId: order?.id || null,
          activeOrderTotal: order?.totalAmount || 0,
        };
      });

      return {
        ...fp,
        tables: tablesWithStatus,
      };
    });

    return result;
  }
}
