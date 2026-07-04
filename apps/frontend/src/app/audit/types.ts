export interface AuditLog {
  id: string;
  organizationId: string;
  userId?: string | null;
  userEmail?: string | null;
  userName?: string | null;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  previousValue?: Record<string, unknown> | null;
  newValue?: Record<string, unknown> | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  createdAt: string;
}

export interface AuditLogsResponse {
  data: AuditLog[];
  meta: {
    total: number;
    offset: number;
    limit: number;
    hasMore: boolean;
  };
}
