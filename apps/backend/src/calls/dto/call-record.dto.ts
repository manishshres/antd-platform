import type { CallRecord, ConversationMessage } from '@platform/shared-types';

/**
 * Neutral call record DTO — provider-agnostic field names.
 * Telnyx-specific terminology is hidden at the service boundary.
 */
export interface CallRecordDto extends CallRecord {}

export interface ConversationMessageDto extends ConversationMessage {
  createdAt?: string;
  sentAt?: string;
}

export interface ConversationResponseDto {
  messages: ConversationMessageDto[];
  conversationId: string | null;
}
