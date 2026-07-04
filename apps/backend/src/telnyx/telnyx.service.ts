import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * TelnyxService provides a centralized wrapper around all Telnyx v2 API calls.
 * Returns typed `unknown` values to satisfy strict TypeScript-ESLint rules;
 * downstream services handle the type narrowing.
 */
@Injectable()
export class TelnyxService {
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

  async getRecordings(): Promise<unknown> {
    return this.fetchJson('/recordings');
  }

  async getTranscriptions(recordingId?: string): Promise<unknown> {
    const params = recordingId
      ? `?filter[recording_id]=${encodeURIComponent(recordingId)}`
      : '';
    return this.fetchJson(`/recording_transcriptions${params}`);
  }

  async getAssistants(): Promise<unknown> {
    return this.fetchJson('/ai/assistants');
  }

  async getAssistant(id: string): Promise<unknown> {
    return this.fetchJson(`/ai/assistants/${encodeURIComponent(id)}`);
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
      const res: any = await this.getAssistant(id);
      const assistant = res?.data || res;
      if (!assistant || !assistant.id) {
        console.warn(
          `Assistant ${id} not found when trying to update dynamic variables.`,
        );
        return;
      }

      const existingVariables = assistant.dynamic_variables || {};
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
      console.warn(
        `Failed to update dynamic variables for assistant ${id}`,
        err,
      );
    }
  }

  async getConversations(assistantId?: string): Promise<unknown> {
    const params = new URLSearchParams({ 'page[size]': '100' });
    if (assistantId) params.set('assistant_id', assistantId);
    return this.fetchJson(`/ai/conversations?${params.toString()}`);
  }

  async getConversationMessages(conversationId: string): Promise<unknown> {
    return this.fetchJson(
      `/ai/conversations/${encodeURIComponent(conversationId)}/messages?page[size]=100`,
    );
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
  ): Promise<unknown> {
    const params = new URLSearchParams({
      'filter[country_code]': countryCode,
      'filter[phone_number_type]': 'local',
      'filter[exclude_held_numbers]': 'true',
      'filter[limit]': limit.toString(),
    });
    params.append('filter[features]', 'hd_voice');

    if (state) params.set('filter[administrative_area]', state);
    if (city) params.set('filter[locality]', city);

    return this.fetchJson(`/available_phone_numbers?${params.toString()}`);
  }
  async getPhoneNumbersByNumber(phoneNumber: string): Promise<unknown> {
    const params = new URLSearchParams({ 'filter[phone_number]': phoneNumber });
    return this.fetchJson(`/phone_numbers?${params.toString()}`);
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

  async uploadKnowledgeDocument(
    fileName: string,
    content: string,
  ): Promise<void> {
    const bucketName = this.configService.get<string>('TELNYX_STORAGE_BUCKET');

    if (!bucketName) {
      throw new Error('TELNYX_STORAGE_BUCKET is not configured.');
    }

    // Step 1: Ensure bucket exists (ignores error if it already exists)
    await fetch(`https://telnyxcloudstorage.com/${bucketName}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${this.apiKey}` },
    }).catch((e) =>
      console.warn(
        `Bucket creation check failed (might already exist): ${e.message}`,
      ),
    );

    // Step 2: Upload file
    const res = await fetch(
      `https://telnyxcloudstorage.com/${bucketName}/${fileName}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: content,
      },
    );

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to upload to Telnyx Storage: ${text}`);
    }
  }

  async embedKnowledgeDocuments(bucketName?: string): Promise<unknown> {
    const bucket =
      bucketName || this.configService.get<string>('TELNYX_STORAGE_BUCKET');
    if (!bucket) {
      throw new Error('TELNYX_STORAGE_BUCKET is not configured.');
    }

    return this.fetchJson('/ai/embeddings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bucket_name: bucket,
        document_chunk_size: 1024,
        document_chunk_overlap_size: 512,
        embedding_model: 'thenlper/gte-large',
        loader: 'default',
      }),
    });
  }

  async createOrUpdateMenuAssistant(
    bucketId: string,
    assistantId?: string,
  ): Promise<string> {
    const assistantName = this.configService.get<string>(
      'TELNYX_AI_ASSISTANT_NAME',
      'Restaurant Voice Agent',
    );

    const assistantConfig = {
      name: assistantName,
      model: 'meta-llama/Meta-Llama-3.1-8B-Instruct',
      description: 'Assistant with custom knowledge base for restaurant menu',
      instructions:
        'You are a helpful restaurant voice assistant. Answer questions and help customers using the provided knowledge base.',
      tools: [
        {
          type: 'retrieval',
          retrieval: {
            bucket_ids: [bucketId],
            max_num_results: 5,
          },
        },
      ],
    };

    if (assistantId) {
      try {
        const updateRes = (await this.fetchJson(
          `/ai/assistants/${encodeURIComponent(assistantId)}`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(assistantConfig),
          },
        )) as any;
        return updateRes?.data?.id || assistantId;
      } catch (e) {
        // If it fails (e.g. 404), fall through to create
        console.warn(
          `Failed to update assistant ${assistantId}, creating new one.`,
          e,
        );
      }
    }

    // Create new
    const createRes = (await this.fetchJson('/ai/assistants', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(assistantConfig),
    })) as any;

    return createRes?.data?.id;
  }
}
