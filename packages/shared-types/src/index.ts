export interface CallRecord {
  id: string;
  from: string;
  to: string;
  durationMs: number;
  status: string;
  startedAt: string;
  recordingUrl: string | null;
  transcriptText: string | null;
  transcriptStatus: string | null;
  sessionId: string;
  aiSummary?: string | null;
  sentiment?: string | null;
  callOutcome?: string | null;
  tags?: unknown | null;
}

export interface ConversationMessage {
  id?: string;
  role: string;
  text: string;
  created_at?: string;
  sent_at?: string;
}

export interface Assistant {
  id: string;
  name: string;
  model: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    total: number;
    offset: number;
    limit: number;
    hasMore: boolean;
  };
}
