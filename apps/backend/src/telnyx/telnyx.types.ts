/**
 * Response shapes for the Telnyx v2 endpoints this codebase actually consumes (N9).
 *
 * These are deliberately partial — Telnyx returns far more than we read, and every field
 * here is optional because the API is external and versioned outside our control. The point
 * is not to model Telnyx exactly; it is to stop `any` leaking out of `TelnyxService` and
 * spreading `no-unsafe-*` errors through every caller.
 *
 * Telnyx uses snake_case on the wire. Keep these types snake_case and map to camelCase at
 * the service boundary — the white-labeling rule in AGENTS.md means these shapes must never
 * escape a controller as-is.
 */

/** Telnyx wraps collections as `{ data, meta }`. */
export interface TelnyxPaginatedResponse<T> {
  data?: T[];
  meta?: TelnyxPageMeta;
}

export interface TelnyxPageMeta {
  total_pages?: number;
  total_results?: number;
  page_number?: number;
  page_size?: number;
}

export interface TelnyxConversation {
  id: string;
  created_at?: string;
  last_message_at?: string;
  metadata?: Record<string, unknown>;
}

export interface TelnyxConversationMessage {
  role?: string;
  text?: string;
  /** Telnyx has used both across API revisions; callers fall back from one to the other. */
  sent_at?: string;
  created_at?: string;
}

export interface TelnyxRecording {
  id?: string;
  call_session_id?: string;
  /** 'single' | 'dual' — callers prefer single-channel for transcription. */
  channels?: string;
  recording_started_at?: string;
  recording_ended_at?: string;
  duration_millis?: number;
  download_urls?: {
    wav?: string;
    mp3?: string;
  };
}

/** AI assistant. Telnyx returns it either bare or wrapped in `{ data }` depending on route. */
export interface TelnyxAssistant {
  id?: string;
  name?: string;
  model?: string;
  instructions?: string;
  dynamic_variables?: Record<string, string>;
  tools?: TelnyxAssistantTool[];
}

export interface TelnyxAssistantTool {
  type?: string;
  retrieval?: {
    bucket_ids?: string[];
    max_num_results?: number;
  };
  [key: string]: unknown;
}

/**
 * `POST /ai/embeddings`. Telnyx has echoed the bucket identifier under several shapes
 * across revisions, so callers fall back through them to the bucket name.
 */
export interface TelnyxEmbeddingResponse {
  bucket_id?: string;
  data?: {
    id?: string;
    bucket_id?: string;
  };
}

/** Single-resource routes wrap the payload in `{ data }`. */
export interface TelnyxSingleResponse<T> {
  data?: T;
}

export type TelnyxAssistantResponse = TelnyxAssistant &
  TelnyxSingleResponse<TelnyxAssistant>;

/** `GET /available_phone_numbers` — numbers offered for purchase. */
export interface TelnyxAvailableNumber {
  phone_number?: string;
  national_format?: string;
}

export type TelnyxAssistantsResponse = TelnyxPaginatedResponse<TelnyxAssistant>;
export type TelnyxAvailableNumbersResponse =
  TelnyxPaginatedResponse<TelnyxAvailableNumber>;

export type TelnyxConversationsResponse =
  TelnyxPaginatedResponse<TelnyxConversation>;
export type TelnyxConversationMessagesResponse =
  TelnyxPaginatedResponse<TelnyxConversationMessage>;
export type TelnyxRecordingsResponse = TelnyxPaginatedResponse<TelnyxRecording>;
