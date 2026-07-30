import type {
  Customer,
  Discount,
  Employee,
  Location,
  ModifierGroup,
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
  modifiers?: ModifierGroup[];
  sku?: string | null;
  isCombo?: boolean;
  taxExempt?: boolean;
  stockQuantity?: number | null;
  lowStockThreshold?: number | null;
}

export interface CallRecordPayload {
  id: string;
  from: string;
  to: string;
  durationMs: number;
  status: string;
  startedAt: string;
  recordingUrl: string | null;
  transcriptText: string | null;
  transcriptStatus: 'completed' | 'pending';
  sessionId: string | null;
  aiSummary: string | null;
  sentiment: string | null;
  callOutcome: string | null;
  tags: string[] | null;
}

export interface FloorPlanPayload {
  id: string;
  name: string;
  width?: number;
  height?: number;
  tables: {
    id: string;
    floorPlanId: string;
    name: string;
    capacity: number;
    shape: string;
    status?: string;
    activeOrderId: string | null;
    activeOrderTotal: number;
    posX?: number;
    posY?: number;
  }[];
}

export interface IntegrationAccountPayload {
  id: string;
  providerId: string;
  providerName: string;
  providerStoreId: string | null;
  status: string;
  isOnline: boolean;
  autoAcceptOrders: boolean;
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
  tipAmount?: number;
  applyServiceCharge?: boolean;
  redeemPoints?: number;
  clientOrderId: string;
  fireMode?: 'all' | 'by_course';
  items: {
    menuItemId: string;
    quantity: number;
    notes?: string;
    course?: number;
    optionIds?: string[];
    priceOverride?: number;
    priceOverrideReason?: string;
  }[];
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
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
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
    const text = await response.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  async getLocations(): Promise<Location[]> {
    return this.request<Location[]>('GET', '/locations');
  }

  async getMenu(locationId?: string): Promise<{ data: MenuCategoryPayload[] }> {
    const qs = new URLSearchParams({ limit: '100' });
    if (locationId) qs.set('locationId', locationId);
    return this.request('GET', `/menus?${qs.toString()}`);
  }

  async createCategory(payload: {
    name: string;
    locationId?: string;
  }): Promise<{ id: string; name: string }> {
    return this.request('POST', '/menus/categories', payload);
  }

  async updateCategory(
    id: string,
    payload: { name?: string; isAvailable?: boolean },
  ): Promise<{ id: string; name: string }> {
    return this.request('PATCH', `/menus/categories/${id}`, payload);
  }

  async deleteCategory(id: string): Promise<{ success: boolean }> {
    return this.request('DELETE', `/menus/categories/${id}`);
  }

  async createMenuItem(payload: {
    categoryId: string;
    name: string;
    description?: string;
    price: number;
    imageUrl?: string;
    locationId?: string;
    sku?: string;
    isCombo?: boolean;
    taxExempt?: boolean;
    stockQuantity?: number;
    lowStockThreshold?: number;
  }): Promise<{ id: string; name: string }> {
    return this.request('POST', '/menus/items', payload);
  }

  async updateMenuItem(
    id: string,
    payload: Partial<{
      name: string;
      description: string;
      price: number;
      categoryId: string;
      imageUrl: string;
      isAvailable: boolean;
      isFavorite: boolean;
      sku: string;
      isCombo: boolean;
      taxExempt: boolean;
      stockQuantity: number;
      lowStockThreshold: number;
    }>,
  ): Promise<{ id: string; name: string }> {
    return this.request('PATCH', `/menus/items/${id}`, payload);
  }

  async deleteMenuItem(id: string): Promise<{ success: boolean }> {
    return this.request('DELETE', `/menus/items/${id}`);
  }

  async getModifierGroups(locationId?: string): Promise<ModifierGroup[]> {
    const qs = locationId ? `?locationId=${encodeURIComponent(locationId)}` : '';
    return this.request('GET', `/menus/modifiers/groups${qs}`);
  }

  async createModifierGroup(payload: {
    name: string;
    locationId?: string;
    isRequired?: boolean;
    multiSelect?: boolean;
    maxSelections?: number;
  }): Promise<{ id: string; name: string }> {
    return this.request('POST', '/menus/modifiers/groups', payload);
  }

  async deleteModifierGroup(id: string): Promise<{ success: boolean }> {
    return this.request('DELETE', `/menus/modifiers/groups/${id}`);
  }

  async createModifierOption(
    modifierId: string,
    payload: { name: string; priceAdjustment: number },
  ): Promise<{ id: string; name: string }> {
    return this.request('POST', `/menus/modifiers/${modifierId}/options`, payload);
  }

  async deleteModifierOption(id: string): Promise<{ success: boolean }> {
    return this.request('DELETE', `/menus/modifiers/options/${id}`);
  }

  async assignModifierToItem(itemId: string, modifierId: string): Promise<unknown> {
    return this.request('POST', `/menus/items/${itemId}/modifiers`, { modifierId });
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

  async createFloorPlan(payload: {
    locationId: string;
    name: string;
  }): Promise<{ id: string; name: string }> {
    return this.request('POST', '/tables/floor-plans', payload);
  }

  async updateFloorPlan(
    id: string,
    payload: { name?: string },
  ): Promise<{ id: string; name: string }> {
    return this.request('PATCH', `/tables/floor-plans/${id}`, payload);
  }

  async deleteFloorPlan(id: string): Promise<void> {
    await this.request('DELETE', `/tables/floor-plans/${id}`);
  }

  async createTable(payload: {
    floorPlanId: string;
    name: string;
    capacity?: number;
    shape?: string;
  }): Promise<{ id: string; name: string }> {
    return this.request('POST', '/tables', payload);
  }

  async updateTable(
    id: string,
    payload: { name?: string; capacity?: number; shape?: string; posX?: number; posY?: number },
  ): Promise<{ id: string; name: string }> {
    return this.request('PATCH', `/tables/${id}`, payload);
  }

  async deleteTable(id: string): Promise<void> {
    await this.request('DELETE', `/tables/${id}`);
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

  async updateOrderStatus(id: string, status: string): Promise<ServerOrder> {
    return this.request<ServerOrder>('PATCH', `/orders/${id}/status`, {
      status,
    });
  }

  async createPosOrder(payload: PosOrderPayload): Promise<{
    id: string;
    ticketNumber: number | null;
    status: string;
    totalAmount: number;
  }> {
    return this.request('POST', '/orders/pos', payload);
  }

  /**
   * Add items to an open tab. Sends only the delta — the server concatenates
   * under a lock — so a second register ringing into the same tab can't drop
   * these lines, nor these theirs. `clientMutationId` makes a retry a no-op.
   */
  async appendOrderItems(
    serverOrderId: string,
    payload: {
      clientMutationId: string;
      items: {
        menuItemId: string;
        quantity: number;
        notes?: string;
        course?: number;
        optionIds?: string[];
        priceOverride?: number;
        priceOverrideReason?: string;
      }[];
    },
  ): Promise<{ id: string; totalAmount: number }> {
    return this.request('POST', `/orders/${serverOrderId}/items`, payload);
  }

  /**
   * Send one course to the kitchen. `clientMutationId` makes a retry — or a
   * double-tapped Fire button — a no-op instead of a second ticket.
   */
  async fireCourse(
    serverOrderId: string,
    payload: { course: number; clientMutationId: string },
  ): Promise<{ id: string }> {
    return this.request('POST', `/orders/${serverOrderId}/fire`, payload);
  }

  /** Settle an open tab. */
  async payOrder(
    serverOrderId: string,
    payload: { paymentMethod: PaymentMethod; tipAmount?: number },
  ): Promise<{ id: string; totalAmount: number; status: string }> {
    return this.request('POST', `/orders/${serverOrderId}/pay`, payload);
  }

  /** Record a split/partial payment against an unpaid order. */
  async recordOrderPayment(
    serverOrderId: string,
    payload: {
      method: PaymentMethod;
      amount?: number;
      cashReceived?: number;
      tipAmount?: number;
    },
  ): Promise<{ applied: number; remaining: number; paid: boolean }> {
    return this.request('POST', `/orders/${serverOrderId}/payments`, payload);
  }

  /** Void and fully refund a paid order — manager PIN required. */
  async refundOrder(
    serverOrderId: string,
    payload: { managerPin: string; reason?: string },
  ): Promise<unknown> {
    return this.request('POST', `/orders/${serverOrderId}/refund`, payload);
  }

  /** Reprint the kitchen ticket / receipt for an order. */
  async printOrder(serverOrderId: string, printerId?: string): Promise<unknown> {
    return this.request('POST', `/orders/${serverOrderId}/print`, {
      printerId,
    });
  }

  /** Partially refund a paid order — manager PIN required. */
  async refundOrderPartial(
    serverOrderId: string,
    payload: { managerPin: string; amount: number; reason?: string },
  ): Promise<unknown> {
    return this.request(
      'POST',
      `/orders/${serverOrderId}/refund-partial`,
      payload,
    );
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

  async getCalls(params?: {
    locationId?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ data: CallRecordPayload[]; total: number; hasMore: boolean }> {
    const qs = new URLSearchParams({
      limit: String(params?.limit ?? 50),
      offset: String(params?.offset ?? 0),
    });
    if (params?.locationId) qs.set('locationId', params.locationId);
    if (params?.search?.trim()) qs.set('search', params.search.trim());
    return this.request('GET', `/calls?${qs.toString()}`);
  }

  async getCall(id: string): Promise<CallRecordPayload> {
    return this.request<CallRecordPayload>('GET', `/calls/${id}`);
  }

  async signInEmployee(email: string, pin: string): Promise<Employee> {
    return this.request<Employee>('POST', '/employees/auth/pin', { email, pin });
  }

  async verifyManagerPin(pin: string, candidateEmployeeId?: string): Promise<Employee> {
    return this.request<Employee>('POST', '/employees/verify-manager-pin', {
      pin,
      ...(candidateEmployeeId ? { candidateEmployeeId } : {}),
    });
  }

  async clockIn(employeeId: string): Promise<{ clockInAt: string }> {
    return this.request('POST', `/employees/${employeeId}/clock-in`);
  }

  async clockOut(employeeId: string): Promise<{ clockOutAt: string }> {
    return this.request('POST', `/employees/${employeeId}/clock-out`);
  }

  async clockStatus(
    employeeId: string,
  ): Promise<{ clockedIn: boolean; since: string | null }> {
    return this.request('GET', `/employees/${employeeId}/clock-status`);
  }

  async getIntegrationAccounts(): Promise<IntegrationAccountPayload[]> {
    return this.request('GET', '/aggregator/integration-accounts');
  }

  async setIntegrationAccountAutoAccept(
    id: string,
    autoAcceptOrders: boolean,
  ): Promise<IntegrationAccountPayload> {
    return this.request('PATCH', `/aggregator/integration-accounts/${id}`, {
      autoAcceptOrders,
    });
  }
}
