import { Controller, Get, Inject } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { getAppVersion } from '../common/version';
import { DRIZZLE } from '../database/database.module';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../database/schema';
import { MqttService } from '../printers/mqtt.service';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

interface RedisClient {
  ping(): Promise<string>;
}

@ApiTags('System Health & Monitoring')
@Controller('health')
export class HealthController {
  constructor(
    @Inject(DRIZZLE)
    private readonly db: NodePgDatabase<typeof schema>,
    private readonly mqttService: MqttService,
    @InjectQueue('print-queue')
    private readonly printQueue: Queue,
  ) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Perform comprehensive health checks' })
  @ApiResponse({ status: 200, description: 'System is healthy' })
  @ApiResponse({
    status: 503,
    description: 'One or more services are unhealthy',
  })
  async getHealth() {
    let dbStatus = 'healthy';
    let dbError: string | null = null;
    try {
      // Validate database connectivity using a fast query
      await this.db.select().from(schema.plans).limit(1);
    } catch (err: unknown) {
      dbStatus = 'unhealthy';
      dbError = err instanceof Error ? err.message : String(err);
    }

    let redisStatus = 'healthy';
    let redisError: string | null = null;
    try {
      const client = (await this.printQueue.client) as unknown as RedisClient;
      const pingRes = await client.ping();
      if (pingRes !== 'PONG') {
        throw new Error('Redis ping response failed.');
      }
    } catch (err: unknown) {
      redisStatus = 'unhealthy';
      redisError = err instanceof Error ? err.message : String(err);
    }

    const mqttConnected = this.mqttService.getIsConnected();
    const mqttStatus = mqttConnected ? 'healthy' : 'unhealthy';

    const overallHealthy =
      dbStatus === 'healthy' &&
      redisStatus === 'healthy' &&
      mqttStatus === 'healthy';

    const healthData = {
      status: overallHealthy ? 'UP' : 'DOWN',
      version: getAppVersion(),
      timestamp: new Date().toISOString(),
      services: {
        database: { status: dbStatus, error: dbError },
        redis: { status: redisStatus, error: redisError },
        mqtt: { status: mqttStatus },
      },
    };

    return healthData;
  }

  @Public()
  @Get('version')
  @ApiOperation({ summary: 'Get the running API version' })
  @ApiResponse({ status: 200, description: 'Version info' })
  getVersion() {
    return { version: getAppVersion() };
  }

  @Public()
  @Get('metrics')
  @ApiOperation({ summary: 'Fetch basic application performance metrics' })
  @ApiResponse({ status: 200, description: 'Metrics data' })
  getMetrics() {
    const memoryUsage = process.memoryUsage();
    return {
      uptime: process.uptime(),
      memory: {
        rss: `${(memoryUsage.rss / 1024 / 1024).toFixed(2)} MB`,
        heapTotal: `${(memoryUsage.heapTotal / 1024 / 1024).toFixed(2)} MB`,
        heapUsed: `${(memoryUsage.heapUsed / 1024 / 1024).toFixed(2)} MB`,
        external: `${(memoryUsage.external / 1024 / 1024).toFixed(2)} MB`,
      },
      cpu: process.cpuUsage(),
    };
  }
}
