import { Injectable, Logger, Inject, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { DRIZZLE } from '../database/database.module';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../database/schema';
import { eq, and, lt, isNotNull } from 'drizzle-orm';
import { MqttService } from './mqtt.service';
import { PrintJobsService } from './print-jobs.service';

/** A printer is considered offline if no heartbeat received in this many ms */
const HEARTBEAT_TIMEOUT_MS = 60_000;
/** Sweep interval to check for stale printers */
const SWEEP_INTERVAL_MS = 30_000;

/**
 * HeartbeatService — manages printer online/offline state via MQTT heartbeats.
 *
 * Printers publish to: `restaurant/{orgId}/printer/{printerId}/heartbeat`
 * Payload: JSON `{ "ts": "<ISO timestamp>", "ip": "<optional IP>" }`
 *
 * On receipt: marks printer as online, updates `lastHeartbeatAt`.
 * On sweep (@Interval): marks printers as offline if `lastHeartbeatAt` > 60s ago.
 */
@Injectable()
export class HeartbeatService implements OnModuleInit {
  private readonly logger = new Logger(HeartbeatService.name);

  constructor(
    private readonly mqttService: MqttService,
    @Inject(DRIZZLE)
    private readonly db: NodePgDatabase<typeof schema>,
    private readonly printJobsService: PrintJobsService,
  ) {}

  onModuleInit() {
    // Standard platform heartbeat wildcard
    this.mqttService.subscribe(
      'restaurant/+/printer/+/heartbeat',
      (topic, payload) => this.handleHeartbeat(topic, payload),
    );
    // HSPOS Cloud Printer default heartbeat topic (Docs say Hearbeat, actual firmware uses heartbeat)
    this.mqttService.subscribe('Hearbeat', (topic, payload) =>
      this.handleHeartbeat(topic, payload),
    );
    this.mqttService.subscribe('heartbeat', (topic, payload) =>
      this.handleHeartbeat(topic, payload),
    );

    // HSPOS Cloud Printer default status topic (Docs say PrintSucces)
    this.mqttService.subscribe('PrintSucces', (_topic, payload) =>
      this.handlePrintStatus(payload),
    );
    this.mqttService.subscribe('printSucces', (_topic, payload) =>
      this.handlePrintStatus(payload),
    );
    this.mqttService.subscribe('PrintSuccess', (_topic, payload) =>
      this.handlePrintStatus(payload),
    );
    this.mqttService.subscribe('printSuccess', (_topic, payload) =>
      this.handlePrintStatus(payload),
    );
    this.logger.log('Heartbeat subscriptions registered for all printers.');
  }

  private async handlePrintStatus(payload: Buffer): Promise<void> {
    const payloadStr = payload.toString();
    // HSPOS Status format: {Type};[{PrinterTopic}];{Status};{TicketId}
    // Type 3: Received, 4: Done, 5: Timeout, 7: Error, 8: Discard
    const match = payloadStr.match(/^(\d);\[(.*?)\];\d+;(.*?)$/);
    if (!match) return;

    const [_, typeStr, printerTopic, ticketId] = match;
    const type = parseInt(typeStr, 10);

    let status: 'queued' | 'retrying' | 'sent' | 'failed' | null = null;
    let lastError: string | undefined;

    if (type === 4) {
      status = 'sent'; // Completed
    } else if (type === 5) {
      status = 'failed';
      lastError = 'Printer reported timeout.';
    } else if (type === 7 || type === 8) {
      status = 'failed';
      lastError = 'Printer reported error or discarded the job.';
    }

    if (status && ticketId) {
      try {
        // A Discard (8) after a Done (4) is benign — the device deduped a second
        // delivery of a ticket it already printed. Never downgrade a sent job.
        if (status === 'failed') {
          const existing = await this.printJobsService.getPrintJob(ticketId);
          if (existing?.status === 'sent') {
            this.logger.log(
              `Ignoring late failure report for already-printed job ${ticketId} (duplicate delivery discarded by printer).`,
            );
            return;
          }
        }
        await this.printJobsService.updatePrintJobStatus(ticketId, status, {
          lastError,
        });
        this.logger.log(
          `Updated print job ${ticketId} status to ${status} based on printer ${printerTopic} report.`,
        );
      } catch (err: unknown) {
        this.logger.error(
          `Failed to update print job ${ticketId} from status report: ${String(err)}`,
        );
      }
    }
  }

  private async handleHeartbeat(topic: string, payload: Buffer): Promise<void> {
    const payloadStr = payload.toString();
    let printerTopicOrId: string | undefined;
    let ipAddress: string | undefined;

    const lowerTopic = topic.toLowerCase();
    if (lowerTopic === 'hearbeat' || lowerTopic === 'heartbeat') {
      // Parse HSPOS format: 1;[Prn...] (login) or 2;[Prn...] (heartbeat)
      const match = payloadStr.match(/^[12];\[(.*?)\];(.*)$/);
      if (match) {
        printerTopicOrId = match[1];
      } else {
        return; // Ignore unrecognized payloads on this global topic
      }
    } else {
      // Parse: restaurant/{orgId}/printer/{printerId}/heartbeat
      const parts = topic.split('/');
      if (parts.length === 5) {
        printerTopicOrId = parts[3];
      }
      try {
        const data = JSON.parse(payloadStr) as { ip?: string };
        ipAddress = data.ip;
      } catch {
        // Payload not JSON — still update heartbeat
      }
    }

    if (!printerTopicOrId) return;

    try {
      // The identifier might be the UUID (id) OR the MQTT topic string (topic)
      await this.db
        .update(schema.printers)
        .set({
          isOnline: true,
          lastHeartbeatAt: new Date(),
          ...(ipAddress ? { ipAddress } : {}),
          updatedAt: new Date(),
        })
        .where(
          lowerTopic === 'hearbeat' || lowerTopic === 'heartbeat'
            ? eq(schema.printers.topic, printerTopicOrId)
            : eq(schema.printers.id, printerTopicOrId),
        );

      // this.logger.debug(
      //   `Heartbeat received for printer ${printerTopicOrId}${ipAddress ? ` (IP: ${ipAddress})` : ''}.`,
      // );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Failed to update heartbeat for printer ${printerTopicOrId}: ${msg}`,
      );
    }
  }

  /**
   * Sweep every 30s — mark any printer whose last heartbeat was more than 60s ago as offline.
   */
  @Interval(SWEEP_INTERVAL_MS)
  async sweepStalePrinters(): Promise<void> {
    const threshold = new Date(Date.now() - HEARTBEAT_TIMEOUT_MS);

    try {
      const result = await this.db
        .update(schema.printers)
        .set({ isOnline: false, updatedAt: new Date() })
        .where(
          and(
            eq(schema.printers.isOnline, true),
            isNotNull(schema.printers.lastHeartbeatAt),
            lt(schema.printers.lastHeartbeatAt, threshold),
          ),
        )
        .returning({ id: schema.printers.id });

      if (result.length > 0) {
        this.logger.warn(
          `Marked ${result.length} printer(s) offline after heartbeat timeout: ${result.map((r) => r.id).join(', ')}`,
        );
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Stale printer sweep failed: ${msg}`);
    }
  }
}
