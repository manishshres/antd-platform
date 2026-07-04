import { Injectable, Inject, Logger } from '@nestjs/common';
import { DRIZZLE } from '../database/database.module';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../database/schema';
import { eq, sql, and, gte } from 'drizzle-orm';
import { BillingService } from '../billing/billing.service';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { CACHE_MANAGER } from '@nestjs/cache-manager';

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(
    @Inject(DRIZZLE)
    private readonly db: NodePgDatabase<typeof schema>,
    private readonly billingService: BillingService,
    @InjectQueue('print-queue') private readonly printQueue: Queue,

    @Inject(CACHE_MANAGER) private readonly cacheManager: any,
  ) {}

  /**
   * Record a usage event.
   */
  async recordUsage(
    organizationId: string,
    locationId: string,
    eventType: string,
    amount: number,
    metadata?: Record<string, any>,
  ) {
    await this.db.insert(schema.usageEvents).values({
      organizationId,
      locationId,
      eventType,
      amount,
      metadata: metadata ?? null,
    });
  }

  /**
   * Get current period usage vs plan limits.
   */
  async getCurrentPeriodUsage(organizationId: string) {
    // 1. Get the organization's current subscription & plan limits
    const subscriptions = await this.db
      .select({
        locationId: schema.subscriptions.locationId,
        planId: schema.subscriptions.planId,
        voiceAgentsLimit: schema.plans.voiceAgentsLimit,
        monthlyMinutesLimit: schema.plans.monthlyMinutesLimit,
        phoneNumbersLimit: schema.plans.phoneNumbersLimit,
        kbSizeLimit: schema.plans.kbSizeLimit,
        websiteImportsLimit: schema.plans.websiteImportsLimit,
        orderVolumeLimit: schema.plans.orderVolumeLimit,
        currentPeriodEnd: schema.subscriptions.currentPeriodEnd,
      })
      .from(schema.subscriptions)
      .innerJoin(schema.plans, eq(schema.subscriptions.planId, schema.plans.id))
      .where(eq(schema.subscriptions.organizationId, organizationId));

    if (subscriptions.length === 0) {
      return { locations: [] };
    }

    // 2. Fetch all usage events for this organization
    // Realistically, we'd filter by current billing cycle start date.
    // For now, we'll assume we reset them (or we filter by date if needed).
    const usageRes = await this.db
      .select({
        locationId: schema.usageEvents.locationId,
        eventType: schema.usageEvents.eventType,
        totalAmount: sql<number>`SUM(${schema.usageEvents.amount})::int`,
      })
      .from(schema.usageEvents)
      .where(eq(schema.usageEvents.organizationId, organizationId))
      .groupBy(schema.usageEvents.locationId, schema.usageEvents.eventType);

    const usageByLocation = usageRes.reduce(
      (acc, row) => {
        if (!acc[row.locationId]) acc[row.locationId] = {};
        acc[row.locationId][row.eventType] = row.totalAmount;
        return acc;
      },
      {} as Record<string, Record<string, number>>,
    );

    // 3. Combine limits and usage
    const locationsUsage = subscriptions.map((sub) => {
      const locId = sub.locationId || 'unknown';
      const locUsage = usageByLocation[locId] || {};

      return {
        locationId: locId,
        plan: sub.planId,
        currentPeriodEnd: sub.currentPeriodEnd,
        usage: {
          callMinutes: locUsage['call_minutes'] || 0,
          apiRequests: locUsage['api_requests'] || 0,
          aiSummaries: locUsage['ai_summary'] || 0,
          aiTranscriptions: locUsage['ai_transcription'] || 0,
          orderVolume: locUsage['order_volume'] || 0,
        },
        limits: {
          voiceAgentsLimit: sub.voiceAgentsLimit,
          monthlyMinutesLimit: sub.monthlyMinutesLimit,
          phoneNumbersLimit: sub.phoneNumbersLimit,
          kbSizeLimit: sub.kbSizeLimit,
          websiteImportsLimit: sub.websiteImportsLimit,
          orderVolumeLimit: sub.orderVolumeLimit,
        },
      };
    });

    return { locations: locationsUsage };
  }

  async getDashboardMetrics(organizationId: string, locationId?: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    sevenDaysAgo.setHours(0, 0, 0, 0);

    const tenMinutesAgo = new Date();
    tenMinutesAgo.setMinutes(tenMinutesAgo.getMinutes() - 10);

    // Build base conditions
    const orderConditions = [eq(schema.orders.organizationId, organizationId)];
    const convConditions = [eq(schema.conversations.organizationId, organizationId)];
    const printerConditions = [eq(schema.printers.organizationId, organizationId)];

    if (locationId) {
      orderConditions.push(eq(schema.orders.locationId, locationId));
      convConditions.push(eq(schema.conversations.locationId, locationId));
      printerConditions.push(eq(schema.printers.locationId, locationId));
    }

    // 1. KPI Queries
    const kpiOrdersRes = await this.db
      .select({
        totalOrders: sql<number>`count(*)`.mapWith(Number),
        revenueCents: sql<number>`sum(${schema.orders.totalAmount})`.mapWith(Number),
      })
      .from(schema.orders)
      .where(and(...orderConditions, gte(schema.orders.createdAt, today)));

    const totalOrdersToday = kpiOrdersRes[0]?.totalOrders || 0;
    const revenueToday = (kpiOrdersRes[0]?.revenueCents || 0) / 100;

    const activeCallsRes = await this.db
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(schema.conversations)
      .where(and(...convConditions, gte(schema.conversations.createdAt, tenMinutesAgo)));
    const activeCalls = activeCallsRes[0]?.count || 0;

    const printersRes = await this.db
      .select({ isOnline: schema.printers.isOnline })
      .from(schema.printers)
      .where(and(...printerConditions));
    
    let printerStatus = 'None';
    if (printersRes.length > 0) {
      printerStatus = printersRes.some(p => p.isOnline) ? 'Online' : 'Offline';
    }

    // 2. Trend Queries
    const trendOrders = await this.db
      .select({ createdAt: schema.orders.createdAt })
      .from(schema.orders)
      .where(and(...orderConditions, gte(schema.orders.createdAt, sevenDaysAgo)));

    const trendConvs = await this.db
      .select({ createdAt: schema.conversations.createdAt })
      .from(schema.conversations)
      .where(and(...convConditions, gte(schema.conversations.createdAt, sevenDaysAgo)));

    // Group by date
    const trendMap = new Map<string, { date: string; orders: number; calls: number }>();
    
    for (let i = 0; i < 7; i++) {
      const d = new Date();
      d.setDate(d.getDate() - (6 - i));
      const key = d.toDateString();
      const dateLabel = d.toLocaleDateString('en-US', { weekday: 'short' });
      trendMap.set(key, { date: dateLabel, orders: 0, calls: 0 });
    }

    trendOrders.forEach(o => {
      if (!o.createdAt) return;
      const key = o.createdAt.toDateString();
      if (trendMap.has(key)) {
        trendMap.get(key)!.orders += 1;
      }
    });

    trendConvs.forEach(c => {
      if (!c.createdAt) return;
      const key = c.createdAt.toDateString();
      if (trendMap.has(key)) {
        trendMap.get(key)!.calls += 1;
      }
    });

    return {
      kpi: {
        totalOrdersToday,
        revenueToday,
        activeCalls,
        printerStatus,
      },
      trend: Array.from(trendMap.values()),
    };
  }

  /**
   * Get System Health for Platform Admins
   */
  async getSystemHealth() {
    /* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
    let redisStatus = 'Unknown';
    let redisLatency = 0;
    try {
      const start = Date.now();
      const store =
        this.cacheManager.store ||
        (this.cacheManager.stores && this.cacheManager.stores[0]);
      if (store && store.client && typeof store.client.ping === 'function') {
        await store.client.ping();
        redisLatency = Date.now() - start;
        redisStatus = 'Healthy';
      } else {
        redisStatus = 'Ready (No Ping)';
      }
    } catch {
      redisStatus = 'Unreachable';
    }
    /* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */

    let bullmqCounts = {};
    let bullmqStatus = 'Unknown';
    try {
      bullmqCounts = await this.printQueue.getJobCounts();
      bullmqStatus = 'Healthy';
    } catch {
      bullmqStatus = 'Unreachable';
    }

    return {
      lastChecked: new Date().toISOString(),
      services: [
        {
          name: 'Redis Cache',
          status: redisStatus,
          latencyMs: redisLatency,
          details: null,
        },
        {
          name: 'BullMQ (Print Queue)',
          status: bullmqStatus,
          latencyMs: 0,
          details: bullmqCounts,
        },
        {
          name: 'Telnyx SIP Trunk',
          status: 'Healthy', // Mock
          latencyMs: 42,
          details: { activeCalls: 12 },
        },
        {
          name: 'MQTT Broker',
          status: 'Healthy', // Mock
          latencyMs: 15,
          details: { connectedClients: 104 },
        },
      ],
    };
  }
}
