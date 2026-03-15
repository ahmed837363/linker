import type {
  AuthTokens,
  LoginRequest,
  RegisterRequest,
  User,
  Tenant,
  PlatformConnection,
  Product,
  ProductFilters,
  InventoryItem,
  InventoryAlert,
  InventoryFilters,
  Order,
  OrderFilters,
  OrderStats,
  PricingRule,
  AnalyticsOverview,
  SalesByPlatform,
  TopProduct,
  RevenueSeries,
  DateRange,
  Granularity,
  OnboardingSession,
  MatchCandidate,
  OnboardingSummary,
  SwipeAction,
  AiConversation,
  AiMessage,
  PaginatedResponse,
  ApiError,
} from '@/types';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000/api/v1';

class ApiClient {
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private refreshPromise: Promise<AuthTokens> | null = null;

  constructor() {
    if (typeof window !== 'undefined') {
      this.accessToken = localStorage.getItem('accessToken');
      this.refreshToken = localStorage.getItem('refreshToken');
    }
  }

  setTokens(tokens: AuthTokens) {
    this.accessToken = tokens.accessToken;
    this.refreshToken = tokens.refreshToken;
    if (typeof window !== 'undefined') {
      localStorage.setItem('accessToken', tokens.accessToken);
      localStorage.setItem('refreshToken', tokens.refreshToken);
    }
  }

  clearTokens() {
    this.accessToken = null;
    this.refreshToken = null;
    if (typeof window !== 'undefined') {
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
    }
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    if (this.accessToken) {
      (headers as Record<string, string>)['Authorization'] = `Bearer ${this.accessToken}`;
    }

    const response = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers,
    });

    if (response.status === 401 && this.refreshToken) {
      try {
        const tokens = await this.performTokenRefresh();
        this.setTokens(tokens);
        (headers as Record<string, string>)['Authorization'] = `Bearer ${tokens.accessToken}`;
        const retryResponse = await fetch(`${API_BASE}${endpoint}`, {
          ...options,
          headers,
        });
        if (!retryResponse.ok) {
          const error: ApiError = await retryResponse.json();
          throw error;
        }
        return retryResponse.json();
      } catch {
        this.clearTokens();
        if (typeof window !== 'undefined') {
          window.location.href = '/login';
        }
        throw { statusCode: 401, message: 'Session expired' } as ApiError;
      }
    }

    if (!response.ok) {
      const error: ApiError = await response.json().catch(() => ({
        statusCode: response.status,
        message: response.statusText,
      }));
      throw error;
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return response.json();
  }

  private async performTokenRefresh(): Promise<AuthTokens> {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: this.refreshToken }),
    }).then(async (res) => {
      this.refreshPromise = null;
      if (!res.ok) throw new Error('Refresh failed');
      return res.json();
    });

    return this.refreshPromise;
  }

  private buildQuery(params: Record<string, unknown>): string {
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        searchParams.append(key, String(value));
      }
    });
    const query = searchParams.toString();
    return query ? `?${query}` : '';
  }

  // ── Auth ──────────────────────────────────────────────────────
  auth = {
    login: (data: LoginRequest): Promise<{ user: User; tenant: Tenant; tokens: AuthTokens }> =>
      this.request('/auth/login', {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    register: (data: RegisterRequest): Promise<{ user: User; tenant: Tenant; tokens: AuthTokens }> =>
      this.request('/auth/register', {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    refresh: (): Promise<AuthTokens> =>
      this.performTokenRefresh(),
  };

  // ── Tenants ───────────────────────────────────────────────────
  tenants = {
    me: (): Promise<{ tenant: Tenant; user: User }> =>
      this.request('/tenants/me'),

    connections: (): Promise<PlatformConnection[]> =>
      this.request('/tenants/connections'),
  };

  // ── Products ──────────────────────────────────────────────────
  products = {
    list: (filters: ProductFilters = {}): Promise<PaginatedResponse<Product>> =>
      this.request(`/products${this.buildQuery(filters as Record<string, unknown>)}`),

    get: (id: string): Promise<Product> =>
      this.request(`/products/${id}`),

    create: (data: Partial<Product>): Promise<Product> =>
      this.request('/products', {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    update: (id: string, data: Partial<Product>): Promise<Product> =>
      this.request(`/products/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),

    pushAll: (id: string): Promise<{ pushed: string[] }> =>
      this.request(`/products/${id}/push`, { method: 'POST' }),
  };

  // ── Inventory ─────────────────────────────────────────────────
  inventory = {
    list: (filters: InventoryFilters = {}): Promise<PaginatedResponse<InventoryItem>> =>
      this.request(`/inventory${this.buildQuery(filters as Record<string, unknown>)}`),

    adjust: (variantId: string, delta: number): Promise<InventoryItem> =>
      this.request(`/inventory/${variantId}/adjust`, {
        method: 'POST',
        body: JSON.stringify({ delta }),
      }),

    alerts: (): Promise<InventoryAlert[]> =>
      this.request('/inventory/alerts'),
  };

  // ── Orders ────────────────────────────────────────────────────
  orders = {
    list: (filters: OrderFilters = {}): Promise<PaginatedResponse<Order>> =>
      this.request(`/orders${this.buildQuery(filters as Record<string, unknown>)}`),

    get: (id: string): Promise<Order> =>
      this.request(`/orders/${id}`),

    stats: (dateRange: DateRange): Promise<OrderStats> =>
      this.request(`/orders/stats?range=${dateRange}`),

    recent: (): Promise<Order[]> =>
      this.request('/orders/recent'),
  };

  // ── Analytics ─────────────────────────────────────────────────
  analytics = {
    overview: (range: DateRange): Promise<AnalyticsOverview> =>
      this.request(`/analytics/overview?range=${range}`),

    byPlatform: (range: DateRange): Promise<SalesByPlatform[]> =>
      this.request(`/analytics/by-platform?range=${range}`),

    topProducts: (range: DateRange): Promise<TopProduct[]> =>
      this.request(`/analytics/top-products?range=${range}`),

    revenueSeries: (range: DateRange, granularity: Granularity): Promise<RevenueSeries[]> =>
      this.request(`/analytics/revenue-series?range=${range}&granularity=${granularity}`),
  };

  // ── Pricing ───────────────────────────────────────────────────
  pricing = {
    listRules: (): Promise<PricingRule[]> =>
      this.request('/pricing/rules'),

    createRule: (data: Partial<PricingRule>): Promise<PricingRule> =>
      this.request('/pricing/rules', {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    updateRule: (id: string, data: Partial<PricingRule>): Promise<PricingRule> =>
      this.request(`/pricing/rules/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),

    deleteRule: (id: string): Promise<void> =>
      this.request(`/pricing/rules/${id}`, { method: 'DELETE' }),
  };

  // ── Onboarding ────────────────────────────────────────────────
  onboarding = {
    start: (): Promise<OnboardingSession> =>
      this.request('/onboarding/start', { method: 'POST' }),

    session: (id: string): Promise<OnboardingSession> =>
      this.request(`/onboarding/sessions/${id}`),

    nextMatch: (sessionId: string): Promise<MatchCandidate | null> =>
      this.request(`/onboarding/sessions/${sessionId}/next-match`),

    swipe: (sessionId: string, matchId: string, action: SwipeAction): Promise<{ next: MatchCandidate | null }> =>
      this.request(`/onboarding/sessions/${sessionId}/swipe`, {
        method: 'POST',
        body: JSON.stringify({ matchId, action }),
      }),

    summary: (sessionId: string): Promise<OnboardingSummary> =>
      this.request(`/onboarding/sessions/${sessionId}/summary`),
  };

  // ── AI Assistant ──────────────────────────────────────────────
  ai = {
    createConversation: (contextType: string): Promise<AiConversation> =>
      this.request('/ai/conversations', {
        method: 'POST',
        body: JSON.stringify({ contextType }),
      }),

    sendMessage: (
      convId: string,
      message: string,
      context?: Record<string, unknown>
    ): Promise<AiMessage> =>
      this.request(`/ai/conversations/${convId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ message, context }),
      }),

    getConversation: (convId: string): Promise<AiConversation> =>
      this.request(`/ai/conversations/${convId}`),
  };
}

export const api = new ApiClient();
export default api;
