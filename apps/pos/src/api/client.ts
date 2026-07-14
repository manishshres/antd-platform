import type {
  Customer,
  Discount,
  Location,
  OrderType,
  PaymentMethod,
  ServerOrder,
  ServerOrderDetail,
} from '../types';

/**
 * Thin typed client for the platform's public API (v2, x-api-key auth).
 * Every call has a hard timeout so a flaky network can never wedge the UI —
 * callers treat ApiNetworkError as "still offline, retry later" and
 * ApiRequestError (4xx/5xx) as a real rejection.
 */

export class ApiNetworkError extends Error {}

export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface MenuCategoryPayload {
  id: string;
  name: string;
  sortOrder: number;
  items: MenuItemPayload[];
}

export interface MenuItemPayload {
  id: string;
  categoryId: string;
  name: string;
  description: string | null;
  price: number;
  imageUrl: string | null;
  isAvailable: boolean;
  isFavorite: boolean;
  sortOrder: number;
}

export interface FloorPlanPayload {
  id: string;
  name: string;
  tables: {
    id: string;
    floorPlanId: string;
    name: string;
    capacity: number;
    shape: string;
    status?: string;
    activeOrderId: string | null;
    activeOrderTotal: number;
  }[];
}

export interface PosOrderPayload {
  locationId: string;
  customerId?: string;
  customerName?: string;
  customerPhone?: string;
  tableId?: string;
  orderType?: OrderType;
  specialInstructions?: string;
  paymentMethod?: PaymentMethod;
  discountId?: string;
  clientOrderId: string;
  items: { menuItemId: string; quantity: number; notes?: string }[];
}

const TIMEOUT_MS = 12000;

export class ApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}

  get isConfigured(): boolean {
    return Boolean(this.baseUrl && this.apiKey);
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.baseUrl.replace(/\/+$/, '')}/api/v2${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        signal: controller.signal,
        headers: {
          'x-api-key': this.apiKey,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      throw new ApiNetworkError(
        err instanceof Error ? err.message : 'Network request failed',
      );
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      let message = `HTTP ${response.status}`;
      try {
        const payload = (await response.json()) as { message?: string | string[] };
        if (payload?.message) {
          message = Array.isArray(payload.message)
            ? payload.message.join('; ')
            : payload.message;
        }
      } catch {
        // non-JSON error body; keep the status message
      }
      throw new ApiRequestError(response.status, message);
    }
    return (await response.json()) as T;
  }

  async getLocations(): Promise<Location[]> {
    return this.request<Location[]>('GET', '/locations');
  }

  async getMenu(locationId?: string): Promise<{ data: MenuCategoryPayload[] }> {
    const qs = new URLSearchParams({ limit: '100' });
    if (locationId) qs.set('locationId', locationId);
    return this.request('GET', `/menus?${qs.toString()}`);
  }

  async getCustomers(search?: string): Promise<Customer[]> {
    const qs = new URLSearchParams({ limit: '200' });
    if (search?.trim()) qs.set('search', search.trim());
    return this.request('GET', `/customers?${qs.toString()}`);
  }

  async upsertCustomer(payload: {
    name: string;
    phone?: string;
    email?: string;
    notes?: string;
  }): Promise<Customer> {
    return this.request('POST', '/customers', payload);
  }

  async getDiscounts(): Promise<Discount[]> {
    return this.request<Discount[]>('GET', '/discounts');
  }

  async getFloorPlans(locationId: string): Promise<FloorPlanPayload[]> {
    const qs = new URLSearchParams({ locationId });
    return this.request('GET', `/tables?${qs.toString()}`);
  }

  async getOrders(params?: {
    q?: string;
    status?: string;
    limit?: number;
    offset?: number;
    dateFrom?: string;
    dateTo?: string;
  }): Promise<{ data: ServerOrder[]; total: number }> {
    const qs = new URLSearchParams({
      limit: String(params?.limit ?? 50),
      offset: String(params?.offset ?? 0),
    });
    if (params?.q?.trim()) qs.set('q', params.q.trim());
    if (params?.status) qs.set('status', params.status);
    if (params?.dateFrom) qs.set('dateFrom', params.dateFrom);
    if (params?.dateTo) qs.set('dateTo', params.dateTo);
    return this.request('GET', `/orders?${qs.toString()}`);
  }

  async getOrderById(id: string): Promise<ServerOrderDetail> {
    return this.request<ServerOrderDetail>('GET', `/orders/${id}`);
  }

  async createPosOrder(payload: PosOrderPayload): Promise<{
    id: string;
    ticketNumber: number | null;
    status: string;
    totalAmount: number;
  }> {
    return this.request('POST', '/orders/pos', payload);
  }

  async getOrderSummary(params: {
    locationId: string;
    dateFrom?: string;
    dateTo?: string;
  }): Promise<{
    openCount: number;
    openTotal: number;
    salesTotal: number;
    salesCount: number;
    refundTotal: number;
    refundCount: number;
  }> {
    const qs = new URLSearchParams({ locationId: params.locationId });
    if (params.dateFrom) qs.set('dateFrom', params.dateFrom);
    if (params.dateTo) qs.set('dateTo', params.dateTo);
    return this.request('GET', `/orders/summary?${qs.toString()}`);
  }

  async getOrderReport(params: {
    locationId: string;
    dateFrom?: string;
    dateTo?: string;
    granularity?: 'day' | 'week' | 'month';
  }): Promise<{
    granularity: string;
    dateFrom: string;
    dateTo: string;
    totals: {
      orders: number;
      sales: number;
      refunds: number;
      refundCount: number;
      netSales: number;
      avgOrder: number;
    };
    series: { period: string; orders: number; sales: number; refunds: number; refundCount: number }[];
    byType: { orderType: string; orders: number; sales: number }[];
    bySource: { source: string | null; orders: number; sales: number }[];
    topItems: { menuItemId: string; name: string; quantity: number; sales: number }[];
  }> {
    const qs = new URLSearchParams({ locationId: params.locationId });
    if (params.dateFrom) qs.set('dateFrom', params.dateFrom);
    if (params.dateTo) qs.set('dateTo', params.dateTo);
    if (params.granularity) qs.set('granularity', params.granularity);
    return this.request('GET', `/orders/reports?${qs.toString()}`);
  }
}
