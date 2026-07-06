import {
  Injectable,
  Inject,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, and, isNull, desc } from 'drizzle-orm';
import { DRIZZLE } from '../database/database.module';
import * as schema from '../database/schema';
import { CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { BillingService } from '../billing/billing.service';
import { AuditService } from '../common/services/audit.service';
import { CreateDiscountDto } from './dto/create-discount.dto';
import { UpdateDiscountDto } from './dto/update-discount.dto';

@Injectable()
export class DiscountsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: NodePgDatabase<typeof schema>,
    private readonly billingService: BillingService,
    private readonly auditService: AuditService,
  ) {}

  /** Active, non-deleted discounts for the POS tender screen. */
  async listActive(user: CurrentUserPayload) {
    const orgId = await this.billingService.getRequiredOrg(user);
    return this.db
      .select()
      .from(schema.discounts)
      .where(
        and(
          eq(schema.discounts.organizationId, orgId),
          eq(schema.discounts.active, true),
          isNull(schema.discounts.deletedAt),
        ),
      )
      .orderBy(desc(schema.discounts.createdAt));
  }

  /** All non-deleted discounts (incl. inactive) for the management UI. */
  async listAll(user: CurrentUserPayload) {
    const orgId = await this.billingService.getRequiredOrg(user);
    return this.db
      .select()
      .from(schema.discounts)
      .where(
        and(
          eq(schema.discounts.organizationId, orgId),
          isNull(schema.discounts.deletedAt),
        ),
      )
      .orderBy(desc(schema.discounts.createdAt));
  }

  async create(user: CurrentUserPayload, dto: CreateDiscountDto) {
    const orgId = await this.billingService.getRequiredOrg(user);
    const code = dto.code?.trim().toUpperCase() || null;

    if (code) {
      const [existing] = await this.db
        .select({ id: schema.discounts.id })
        .from(schema.discounts)
        .where(
          and(
            eq(schema.discounts.organizationId, orgId),
            eq(schema.discounts.code, code),
            isNull(schema.discounts.deletedAt),
          ),
        )
        .limit(1);
      if (existing) {
        throw new ConflictException(`Promo code "${code}" already exists.`);
      }
    }

    const [created] = await this.db
      .insert(schema.discounts)
      .values({
        organizationId: orgId,
        locationId: dto.locationId ?? null,
        name: dto.name.trim(),
        code,
        type: dto.type,
        value: dto.value,
        requiresManager: dto.requiresManager ?? false,
      })
      .returning();

    void this.auditService.log({
      action: 'discount.create',
      userId: user.id,
      organizationId: orgId,
      entityType: 'discount',
      entityId: created.id,
      newValue: created,
    });
    return created;
  }

  async update(user: CurrentUserPayload, id: string, dto: UpdateDiscountDto) {
    const orgId = await this.billingService.getRequiredOrg(user);
    const [existing] = await this.db
      .select()
      .from(schema.discounts)
      .where(
        and(
          eq(schema.discounts.id, id),
          eq(schema.discounts.organizationId, orgId),
          isNull(schema.discounts.deletedAt),
        ),
      )
      .limit(1);
    if (!existing) throw new NotFoundException('Discount not found.');

    const [updated] = await this.db
      .update(schema.discounts)
      .set({
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.code !== undefined
          ? { code: dto.code?.trim().toUpperCase() || null }
          : {}),
        ...(dto.type !== undefined ? { type: dto.type } : {}),
        ...(dto.value !== undefined ? { value: dto.value } : {}),
        ...(dto.requiresManager !== undefined
          ? { requiresManager: dto.requiresManager }
          : {}),
        ...(dto.active !== undefined ? { active: dto.active } : {}),
        ...(dto.locationId !== undefined
          ? { locationId: dto.locationId ?? null }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.discounts.id, id))
      .returning();

    void this.auditService.log({
      action: 'discount.update',
      userId: user.id,
      organizationId: orgId,
      entityType: 'discount',
      entityId: id,
      previousValue: existing,
      newValue: updated,
    });
    return updated;
  }

  async remove(user: CurrentUserPayload, id: string) {
    const orgId = await this.billingService.getRequiredOrg(user);
    const [removed] = await this.db
      .update(schema.discounts)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(schema.discounts.id, id),
          eq(schema.discounts.organizationId, orgId),
          isNull(schema.discounts.deletedAt),
        ),
      )
      .returning();
    if (!removed) throw new NotFoundException('Discount not found.');

    void this.auditService.log({
      action: 'discount.delete',
      userId: user.id,
      organizationId: orgId,
      entityType: 'discount',
      entityId: id,
      previousValue: removed,
    });
    return { success: true };
  }
}
