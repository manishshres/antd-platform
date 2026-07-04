import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StorageService } from '../storage/storage.service';
import { TelnyxService } from '../telnyx/telnyx.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { DRIZZLE } from '../database/database.module';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import * as schema from '../database/schema';

export interface ImportRecordingPayload {
  callSessionId: string;
  recordingId: string;
  /** The dialed (destination) number — used to resolve the owning tenant. */
  toNumber?: string;
  organizationId?: string;
  locationId?: string;
}

@Processor('recordings-queue')
export class RecordingsProcessor extends WorkerHost {
  private readonly logger = new Logger(RecordingsProcessor.name);
  private readonly ai: GoogleGenerativeAI | null = null;

  constructor(
    private readonly storageService: StorageService,
    private readonly telnyxService: TelnyxService,
    private readonly configService: ConfigService,
    private readonly analyticsService: AnalyticsService,
    @Inject(DRIZZLE)
    private readonly db: NodePgDatabase<typeof schema>,
  ) {
    super();
    const apiKey = this.configService.get<string>('GEMINI_API_KEY');
    if (apiKey) {
      this.ai = new GoogleGenerativeAI(apiKey);
    } else {
      this.logger.warn(
        'GEMINI_API_KEY not found. AI Summaries will be skipped.',
      );
    }
  }

  async process(job: Job<ImportRecordingPayload>): Promise<void> {
    const { callSessionId, recordingId, toNumber } = job.data;
    let { organizationId, locationId } = job.data;
    this.logger.log(`Processing recording import for session ${callSessionId}`);

    // Tenant isolation (C2): resolve the owning location from the dialed number instead of
    // defaulting to an arbitrary "first location", which would leak recordings across tenants.
    if (!organizationId || !locationId) {
      const resolved = await this.resolveTenantByNumber(toNumber);
      if (!resolved) {
        this.logger.warn(
          `Could not resolve owning tenant for recording ${recordingId} ` +
            `(session ${callSessionId}, to=${toNumber ?? 'unknown'}). Skipping to avoid cross-tenant assignment.`,
        );
        return;
      }
      organizationId = resolved.organizationId;
      locationId = resolved.locationId;
    }

    try {
      // 1. Fetch recording details from Telnyx
      const rawRecRes = (await this.telnyxService.getRecordings()) as Record<
        string,
        unknown
      >;
      const allRecordings =
        (rawRecRes?.data as Record<string, unknown>[]) || [];
      const recording = allRecordings.find((r) => r.id === recordingId);

      if (!recording) {
        throw new Error(`Recording ${recordingId} not found in Telnyx.`);
      }

      const wavUrl = (recording.download_urls as Record<string, string>)?.wav;
      if (!wavUrl) {
        throw new Error(`No WAV download URL for recording ${recordingId}`);
      }

      // 2. Download and upload to S3
      const durationMs = (recording.duration_millis as number) || 0;
      const fromNumber = (recording.from as string) || '';
      const toNumber = (recording.to as string) || '';
      const objectKey = `recordings/${organizationId}/${locationId}/${callSessionId}.wav`;

      this.logger.log(`Downloading recording from ${wavUrl}`);
      const response = await fetch(wavUrl);
      if (!response.ok || !response.body) {
        throw new Error(`Failed to download audio. Status: ${response.status}`);
      }

      this.logger.log(`Uploading to object storage at ${objectKey}`);
      // Cast the web stream to NodeJS readable stream
      await this.storageService.uploadStream(
        objectKey,
        response.body as unknown as NodeJS.ReadableStream,
        'audio/wav',
      );

      // 3. Fetch transcript
      let transcriptText = '';
      const txRes = (await this.telnyxService.getTranscriptions()) as Record<
        string,
        unknown
      >;
      const allTx = (txRes?.data as Record<string, unknown>[]) || [];
      const tx = allTx.find((t) => t.recording_id === recordingId);
      if (tx && tx.transcription_text) {
        transcriptText = tx.transcription_text as string;
      }

      // 4. Summarize via Gemini
      let aiSummary = '';
      let sentiment = 'neutral';
      let callOutcome = 'unknown';

      if (this.ai && transcriptText.length > 50) {
        try {
          const model = this.ai.getGenerativeModel({
            model: 'gemini-1.5-flash',
          });
          const prompt = `
          Analyze the following call transcript. 
          Return a JSON object with exactly three fields:
          - summary: A brief 2-3 sentence summary of the call.
          - sentiment: One of "positive", "negative", "neutral".
          - outcome: A short phrase describing the outcome (e.g. "Order Placed", "Question Answered", "Complaint", "Voicemail").

          Transcript:
          ${transcriptText}
          `;

          const result = await model.generateContent(prompt);
          const responseText = result.response.text();
          // parse JSON from response text (which might include markdown formatting)
          const jsonMatch = responseText.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const data = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
            aiSummary = (data.summary as string) || '';
            sentiment = (data.sentiment as string) || 'neutral';
            callOutcome = (data.outcome as string) || 'unknown';
          }
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          this.logger.error(`AI Summary failed: ${msg}`);
        }
      }

      // 5. Store in DB (recordings table)
      await this.db
        .insert(schema.recordings)
        .values({
          organizationId,
          locationId,
          callSessionId,
          fromNumber,
          toNumber,
          objectKey,
          durationMs,
          transcript: transcriptText,
          aiSummary,
          sentiment,
          callOutcome,
          status: 'uploaded',
          tags: [],
        })
        .onConflictDoUpdate({
          target: schema.recordings.callSessionId,
          set: {
            fromNumber,
            toNumber,
            objectKey,
            durationMs,
            transcript: transcriptText,
            aiSummary,
            sentiment,
            callOutcome,
            status: 'uploaded',
            updatedAt: new Date(),
          },
        });

      if (durationMs > 0) {
        void this.analyticsService.recordUsage(
          organizationId,
          locationId,
          'call_minutes',
          Math.ceil(durationMs / 60000),
          { callSessionId },
        );
      }
      if (transcriptText) {
        void this.analyticsService.recordUsage(
          organizationId,
          locationId,
          'ai_transcription',
          1,
          { callSessionId },
        );
      }
      if (aiSummary) {
        void this.analyticsService.recordUsage(
          organizationId,
          locationId,
          'ai_summary',
          1,
          { callSessionId },
        );
      }

      this.logger.log(
        `Saved recording metadata to DB for session ${callSessionId}`,
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to process recording ${recordingId}: ${msg}`);

      // Mark as failed in DB if possible
      await this.db
        .insert(schema.recordings)
        .values({
          organizationId,
          locationId,
          callSessionId,
          status: 'failed',
        })
        .onConflictDoUpdate({
          target: schema.recordings.callSessionId,
          set: { status: 'failed', updatedAt: new Date() },
        });

      throw err;
    }
  }

  /**
   * Resolve the tenant that owns a dialed number. Checks the provisioned
   * `org_phone_numbers` mapping first, then falls back to `locations.phoneNumber`.
   * Returns null when the number cannot be matched — the caller then skips the job
   * rather than assigning the recording to an arbitrary tenant.
   */
  private async resolveTenantByNumber(
    toNumber: string | undefined,
  ): Promise<{ organizationId: string; locationId: string } | null> {
    if (!toNumber) return null;

    const [mapped] = await this.db
      .select({
        organizationId: schema.orgPhoneNumbers.organizationId,
        locationId: schema.orgPhoneNumbers.locationId,
      })
      .from(schema.orgPhoneNumbers)
      .where(eq(schema.orgPhoneNumbers.phoneNumber, toNumber))
      .limit(1);

    if (mapped?.locationId) {
      return {
        organizationId: mapped.organizationId,
        locationId: mapped.locationId,
      };
    }

    const [loc] = await this.db
      .select({
        organizationId: schema.locations.organizationId,
        locationId: schema.locations.id,
      })
      .from(schema.locations)
      .where(eq(schema.locations.phoneNumber, toNumber))
      .limit(1);

    if (loc) {
      return { organizationId: loc.organizationId, locationId: loc.locationId };
    }

    return null;
  }
}
