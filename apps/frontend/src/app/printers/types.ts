export interface Printer {
  id: string;
  name: string;
  topic: string;
  notes?: string | null;
  locationId: string;
  isOnline: boolean;
  lastHeartbeatAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePrinterDto {
  name: string;
  topic: string;
  notes?: string;
}

export interface UpdatePrinterDto {
  name?: string;
  topic?: string;
  notes?: string;
}

export interface PrintJob {
  id: string;
  organizationId: string;
  locationId: string;
  printerId: string;
  orderId?: string | null;
  jobType: string; // 'kitchen' | 'receipt'
  status: string; // 'queued' | 'sent' | 'failed' | 'retrying'
  attempts: number;
  lastError?: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
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
