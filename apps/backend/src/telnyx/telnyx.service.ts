import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  TelnyxAssistantResponse,
  TelnyxAssistantsResponse,
  TelnyxAvailableNumbersResponse,
  TelnyxAssistantTool,
  TelnyxConversationMessagesResponse,
  TelnyxEmbeddingResponse,
  TelnyxConversationsResponse,
  TelnyxOwnedNumbersResponse,
  TelnyxRecordingsResponse,
} from './telnyx.types';

/**
 * Raised when Telnyx Cloud Storage rejects an operation with `UserSuspended` — per Telnyx billing
 * docs this means the account's *available credit* is negative (storage is blocked, and the free
 * tier is disabled, until credit is restored via payment). A distinct type so callers can show a
 * clear message to users and skip pointless retries. Extends ServiceUnavailableException so the
 * HTTP layer answers 503 with this message instead of a generic 500.
 */
export class TelnyxStorageSuspendedError extends ServiceUnavailableException {
  constructor() {
    super(
      'AI menu sync is temporarily unavailable — Telnyx Cloud Storage access is restricted. Contact support.',
    );
  }
}

/**
 * TelnyxService provides a centralized wrapper around all Telnyx v2 API calls.
 * Returns typed `unknown` values to satisfy strict TypeScript-ESLint rules;
 * downstream services handle the type narrowing.
 */
@Injectable()
export class TelnyxService {
  private readonly logger = new Logger(TelnyxService.name);
  private readonly apiKey: string;
  private readonly baseURL: string;

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>('TELNYX_API_KEY') ?? '';
    this.baseURL =
      this.configService.get<string>(
        'TELNYX_BASE_URL',
        'https://api.telnyx.com/v2',
      ) ?? 'https://api.telnyx.com/v2';
  }

  private get headers(): Record<string, string> {
    return { Authorization: `Bearer ${this.apiKey}` };
  }

  private async fetchJson(
    path: string,
    options?: RequestInit,
  ): Promise<unknown> {
    const res = await fetch(`${this.baseURL}${path}`, {
      ...options,
      headers: {
        ...this.headers,
        ...(options?.headers as Record<string, string> | undefined),
      },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Telnyx API error (${String(res.status)}): ${text}`);
    }
    return res.json() as Promise<unknown>;
  }

  async getRecordings(
    callSessionId?: string,
  ): Promise<TelnyxRecordingsResponse> {
    const params = new URLSearchParams();
    if (callSessionId) params.set('filter[call_session_id]', callSessionId);
    const queryString = params.toString();
    return (await this.fetchJson(
      `/recordings${queryString ? `?${queryString}` : ''}`,
    )) as TelnyxRecordingsResponse;
  }

  async getTranscriptions(recordingId?: string): Promise<unknown> {
    const params = recordingId
      ? `?filter[recording_id]=${encodeURIComponent(recordingId)}`
      : '';
    return this.fetchJson(`/recording_transcriptions${params}`);
  }

  async getAssistants(): Promise<TelnyxAssistantsResponse> {
    return (await this.fetchJson('/ai/assistants')) as TelnyxAssistantsResponse;
  }

  async getAssistant(id: string): Promise<TelnyxAssistantResponse> {
    return (await this.fetchJson(
      `/ai/assistants/${encodeURIComponent(id)}`,
    )) as TelnyxAssistantResponse;
  }

  async updateAssistant(
    id: string,
    body: Record<string, unknown>,
  ): Promise<unknown> {
    return this.fetchJson(`/ai/assistants/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  async updateAssistantDynamicVariable(
    id: string,
    variables: Record<string, string>,
  ): Promise<void> {
    try {
      const res = await this.getAssistant(id);
      const assistant = res?.data ?? res;
      if (!assistant?.id) {
        this.logger.warn(
          `Assistant ${id} not found when trying to update dynamic variables.`,
        );
        return;
      }

      const existingVariables = assistant.dynamic_variables ?? {};
      const newVariables = { ...existingVariables, ...variables };

      const updatePayload = {
        dynamic_variables: newVariables,
      };

      await this.fetchJson(`/ai/assistants/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatePayload),
      });
    } catch (err) {
      this.logger.warn(
        `Failed to update dynamic variables for assistant ${id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  async getConversations(
    assistantId?: string,
    pageNumber = 1,
  ): Promise<TelnyxConversationsResponse> {
    const params = new URLSearchParams({
      'page[size]': '100',
      'page[number]': String(pageNumber),
    });
    if (assistantId) {
      params.set('metadata->assistant_id', `eq.${assistantId}`);
    }
    return (await this.fetchJson(
      `/ai/conversations?${params.toString()}`,
    )) as TelnyxConversationsResponse;
  }

  async getConversationMessages(
    conversationId: string,
  ): Promise<TelnyxConversationMessagesResponse> {
    return (await this.fetchJson(
      `/ai/conversations/${encodeURIComponent(conversationId)}/messages?page[size]=100`,
    )) as TelnyxConversationMessagesResponse;
  }

  async getDocuments(): Promise<unknown> {
    return this.fetchJson('/documents');
  }

  async uploadDocument(
    filename: string,
    buffer: Buffer,
    mimeType: string,
  ): Promise<unknown> {
    const blob = new Blob([new Uint8Array(buffer)], {
      type: mimeType || 'application/octet-stream',
    });
    const form = new FormData();
    form.append('file', blob, filename);

    const res = await fetch(`${this.baseURL}/documents`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: form,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Upload failed (${String(res.status)}): ${text}`);
    }

    return res.json() as Promise<unknown>;
  }

  async deleteDocument(id: string): Promise<boolean> {
    const res = await fetch(
      `${this.baseURL}/documents/${encodeURIComponent(id)}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${this.apiKey}` },
      },
    );

    if (!res.ok) throw new Error(`Delete failed: ${String(res.status)}`);
    return true;
  }
  async searchAvailableNumbers(
    countryCode: string,
    state?: string,
    city?: string,
    limit = 10,
  ): Promise<TelnyxAvailableNumbersResponse> {
    const params = new URLSearchParams({
      'filter[country_code]': countryCode,
      'filter[phone_number_type]': 'local',
      'filter[exclude_held_numbers]': 'true',
      'filter[limit]': limit.toString(),
    });
    params.append('filter[features]', 'hd_voice');

    if (state) params.set('filter[administrative_area]', state);
    if (city) params.set('filter[locality]', city);

    return (await this.fetchJson(
      `/available_phone_numbers?${params.toString()}`,
    )) as TelnyxAvailableNumbersResponse;
  }
  async getPhoneNumbersByNumber(phoneNumber: string): Promise<unknown> {
    const params = new URLSearchParams({ 'filter[phone_number]': phoneNumber });
    return this.fetchJson(`/phone_numbers?${params.toString()}`);
  }

  /**
   * Numbers already owned by the account and routed through `connectionId` (a TeXML app id).
   * This is how an assistant's phone number is resolved: an assistant owns a TeXML app, and
   * a number "belongs" to that assistant when its connection points at the app.
   */
  async getPhoneNumbersByConnection(
    connectionId: string,
  ): Promise<TelnyxOwnedNumbersResponse> {
    const params = new URLSearchParams({
      'filter[connection_id]': connectionId,
    });
    return (await this.fetchJson(
      `/phone_numbers?${params.toString()}`,
    )) as TelnyxOwnedNumbersResponse;
  }

  async createNumberOrder(phoneNumber: string): Promise<unknown> {
    return this.fetchJson('/number_orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone_numbers: [{ phone_number: phoneNumber }],
      }),
    });
  }

  async getNumberOrder(orderId: string): Promise<unknown> {
    return this.fetchJson(`/number_orders/${encodeURIComponent(orderId)}`);
  }

  async getPhoneNumber(phoneNumberId: string): Promise<unknown> {
    return this.fetchJson(
      `/phone_numbers/${encodeURIComponent(phoneNumberId)}`,
    );
  }

  async updatePhoneNumber(
    phoneNumberId: string,
    body: Record<string, unknown>,
  ): Promise<unknown> {
    return this.fetchJson(
      `/phone_numbers/${encodeURIComponent(phoneNumberId)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    );
  }

  async deletePhoneNumber(phoneNumberId: string): Promise<unknown> {
    return this.fetchJson(
      `/phone_numbers/${encodeURIComponent(phoneNumberId)}`,
      {
        method: 'DELETE',
      },
    );
  }

  async cloneAssistant(assistantId: string): Promise<unknown> {
    return this.fetchJson(
      `/ai/assistants/${encodeURIComponent(assistantId)}/clone`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      },
    );
  }

  async deleteAssistant(assistantId: string): Promise<unknown> {
    return this.fetchJson(`/ai/assistants/${encodeURIComponent(assistantId)}`, {
      method: 'DELETE',
    });
  }

  async sendMessage(from: string, to: string, text: string): Promise<unknown> {
    return this.fetchJson('/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, text }),
    });
  }

  /** True when a Telnyx API key is configured — callers should skip AI sync when it isn't. */
  isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  /**
   * Regional Cloud Storage endpoint. The bare telnyxcloudstorage.com domain 301s
   * bucket operations to an internal Telnyx host that is not publicly resolvable,
   * so requests must target the bucket's region directly (S3-style).
   */
  private get storageBaseUrl(): string {
    const region = this.configService.get<string>(
      'TELNYX_STORAGE_REGION',
      'us-east-1',
    );
    return `https://${region}.telnyxcloudstorage.com`;
  }

  async uploadKnowledgeDocument(
    fileName: string,
    content: string,
    bucketNameOverride?: string,
  ): Promise<void> {
    const bucketName =
      bucketNameOverride ||
      this.configService.get<string>('TELNYX_STORAGE_BUCKET');

    if (!bucketName) {
      throw new Error('TELNYX_STORAGE_BUCKET is not configured.');
    }

    // Step 1: Ensure bucket exists (409 = already exists, which is fine)
    const createRes = await fetch(`${this.storageBaseUrl}/${bucketName}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${this.apiKey}` },
    }).catch((e: Error) => {
      this.logger.warn(`Bucket creation request failed: ${e.message}`);
      return null;
    });
    if (createRes && !createRes.ok && createRes.status !== 409) {
      this.logger.warn(
        `Bucket creation for "${bucketName}" returned ${createRes.status} — continuing to upload.`,
      );
    }

    // Step 2: Upload file
    const uploadUrl = `${this.storageBaseUrl}/${bucketName}/${fileName}`;
    const res = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: content,
    });

    if (!res.ok) {
      const text = await res.text();
      // 403 UserSuspended = negative available credit on the Telnyx account; surface a clear,
      // actionable error rather than a raw storage dump.
      if (res.status === 403 && text.includes('UserSuspended')) {
        // Log the exact request + raw Telnyx body so it can be forwarded to Telnyx support as
        // evidence of the storage-write restriction (they asked for the precise 403 payload).
        this.logger.error(
          `Telnyx Cloud Storage write blocked (UserSuspended). ` +
            `PUT ${uploadUrl} → ${res.status} ${res.statusText}. Raw response: ${text}`,
        );
        throw new TelnyxStorageSuspendedError();
      }
      throw new Error(`Failed to upload to Telnyx Storage: ${text}`);
    }
  }

  async embedKnowledgeDocuments(
    bucketName?: string,
  ): Promise<TelnyxEmbeddingResponse> {
    const bucket =
      bucketName || this.configService.get<string>('TELNYX_STORAGE_BUCKET');
    if (!bucket) {
      throw new Error('TELNYX_STORAGE_BUCKET is not configured.');
    }

    return (await this.fetchJson('/ai/embeddings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bucket_name: bucket,
        document_chunk_size: 1024,
        document_chunk_overlap_size: 512,
        embedding_model: 'thenlper/gte-large',
        loader: 'default',
      }),
    })) as TelnyxEmbeddingResponse;
  }

  async createOrUpdateMenuAssistant(
    bucketId: string,
    assistantId?: string,
  ): Promise<string> {
    if (assistantId) {
      // Existing assistant: NEVER resend the full config — that would overwrite the
      // operator's custom instructions and replace all tools (order webhooks, transfer,
      // hangup) with a bare retrieval tool. Only the retrieval bucket link is managed here.
      try {
        const existingRes = (await this.fetchJson(
          `/ai/assistants/${encodeURIComponent(assistantId)}`,
        )) as TelnyxAssistantResponse;
        const assistant = existingRes?.data ?? existingRes;
        const tools: TelnyxAssistantTool[] = Array.isArray(assistant?.tools)
          ? assistant.tools
          : [];
        const retrieval = tools.find((t) => t?.type === 'retrieval');
        const bucketIds: string[] = retrieval?.retrieval?.bucket_ids ?? [];

        if (bucketIds.includes(bucketId)) {
          return assistantId; // already linked — nothing to change
        }

        // Send only the retrieval tool: Telnyx merges tool updates, and resubmitting
        // the shared webhook tools trips its unique-name validation.
        await this.fetchJson(
          `/ai/assistants/${encodeURIComponent(assistantId)}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              tools: [
                {
                  type: 'retrieval',
                  retrieval: {
                    bucket_ids: [bucketId],
                    max_num_results: retrieval?.retrieval?.max_num_results ?? 5,
                  },
                },
              ],
            }),
          },
        );
        return assistantId;
      } catch (e: unknown) {
        // Do NOT fall through to create — replacing the location's assistant with a
        // generic one loses the operator's configuration. Keep the existing link and
        // surface the problem in the logs instead.
        const msg = e instanceof Error ? e.message : String(e);
        this.logger.warn(
          `Could not relink assistant ${assistantId} retrieval to bucket "${bucketId}": ${msg}. ` +
            'Assistant left unchanged — update the retrieval bucket in the Telnyx portal if needed.',
        );
        return assistantId;
      }
    }

    // First publish for this location: create a starter assistant. Operators
    // customize instructions/tools afterwards; later syncs never overwrite them.
    const assistantName = this.configService.get<string>(
      'TELNYX_AI_ASSISTANT_NAME',
      'Restaurant Voice Agent',
    );
    const createRes = (await this.fetchJson('/ai/assistants', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: assistantName,
        model: 'meta-llama/Meta-Llama-3.1-8B-Instruct',
        description: 'Assistant with custom knowledge base for restaurant menu',
        instructions:
          'You are a helpful restaurant voice assistant. Answer questions and help customers using the provided knowledge base.',
        tools: [
          {
            type: 'retrieval',
            retrieval: { bucket_ids: [bucketId], max_num_results: 5 },
          },
        ],
      }),
    })) as TelnyxAssistantResponse;

    const createdId = createRes?.data?.id ?? createRes?.id;
    if (!createdId) {
      throw new Error('Telnyx did not return an id for the created assistant.');
    }
    return createdId;
  }
}
