// ─── Auth & Tenant ──────────────────────────────────────────────
export interface User {
  id: string;
  email: string;
  fullName: string;
  avatarUrl?: string;
  role: 'owner' | 'admin' | 'member';
  createdAt: string;
  updatedAt: string;
}

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  plan: 'free' | 'starter' | 'pro' | 'enterprise';
  logoUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  tenantName: string;
  fullName: string;
  email: string;
  password: string;
}

// ─── Platforms ───────────────────────────────────────────────────
export type Platform =
  | 'shopify'
  | 'salla'
  | 'woocommerce'
  | 'amazon'
  | 'noon'
  | 'zid'
  | 'tiktok_shop'
  | 'ebay'
  | 'etsy'
  | 'walmart'
  | 'mercado_libre'
  | 'aliexpress'
  | 'magento';

export interface PlatformConnection {
  id: string;
  platform: Platform;
  storeName: string;
  storeUrl?: string;
  status: 'active' | 'inactive' | 'error' | 'syncing';
  lastSyncAt?: string;
  productsCount: number;
  ordersCount: number;
  createdAt: string;
}

// ─── Products ───────────────────────────────────────────────────
export interface Product {
  id: string;
  title: string;
  description?: string;
  imageUrl?: string;
  images: string[];
  status: 'active' | 'draft' | 'archived';
  variants: ProductVariant[];
  listings: PlatformListing[];
  category?: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ProductVariant {
  id: string;
  productId: string;
  sku: string;
  title: string;
  price: number;
  compareAtPrice?: number;
  currency: string;
  stockQuantity: number;
  lowStockThreshold: number;
  weight?: number;
  weightUnit?: string;
  attributes: Record<string, string>;
}

export interface PlatformListing {
  id: string;
  productId: string;
  platform: Platform;
  platformProductId: string;
  status: 'active' | 'inactive' | 'error' | 'pending';
  url?: string;
  lastSyncAt?: string;
}

export interface ProductFilters {
  search?: string;
  status?: string;
  platform?: string;
  category?: string;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

// ─── Inventory ──────────────────────────────────────────────────
export interface InventoryItem {
  variantId: string;
  productId: string;
  productTitle: string;
  variantTitle: string;
  sku: string;
  stockQuantity: number;
  lowStockThreshold: number;
  status: 'in_stock' | 'low_stock' | 'out_of_stock';
  platformSync: {
    platform: Platform;
    synced: boolean;
    lastSyncAt?: string;
  }[];
}

export interface InventoryAlert {
  id: string;
  variantId: string;
  productTitle: string;
  sku: string;
  stockQuantity: number;
  threshold: number;
  type: 'low_stock' | 'out_of_stock';
  createdAt: string;
}

export interface InventoryFilters {
  search?: string;
  status?: string;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

// ─── Orders ─────────────────────────────────────────────────────
export interface Order {
  id: string;
  orderNumber: string;
  platform: Platform;
  platformOrderId: string;
  customerName: string;
  customerEmail: string;
  items: OrderItem[];
  subtotal: number;
  tax: number;
  shipping: number;
  total: number;
  currency: string;
  status: 'pending' | 'confirmed' | 'processing' | 'shipped' | 'delivered' | 'cancelled' | 'refunded';
  shippingAddress?: Address;
  trackingNumber?: string;
  createdAt: string;
  updatedAt: string;
}

export interface OrderItem {
  id: string;
  productId: string;
  variantId: string;
  title: string;
  sku: string;
  quantity: number;
  unitPrice: number;
  total: number;
  imageUrl?: string;
}

export interface Address {
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

export interface OrderFilters {
  search?: string;
  status?: string;
  platform?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface OrderStats {
  totalOrders: number;
  totalRevenue: number;
  averageOrderValue: number;
  ordersByStatus: Record<string, number>;
  ordersByPlatform: Record<string, number>;
}

// ─── Pricing ────────────────────────────────────────────────────
export type PricingRuleType = 'markup' | 'markdown' | 'fixed' | 'match_lowest' | 'round';

export interface PricingRule {
  id: string;
  name: string;
  type: PricingRuleType;
  platform: Platform | 'all';
  adjustment: number;
  isPercentage: boolean;
  isActive: boolean;
  priority: number;
  conditions?: PricingCondition[];
  createdAt: string;
  updatedAt: string;
}

export interface PricingCondition {
  field: string;
  operator: 'eq' | 'neq' | 'gt' | 'lt' | 'gte' | 'lte' | 'contains';
  value: string | number;
}

// ─── Analytics ──────────────────────────────────────────────────
export interface AnalyticsOverview {
  totalRevenue: number;
  revenueChange: number;
  totalOrders: number;
  ordersChange: number;
  activeProducts: number;
  productsChange: number;
  conversionRate: number;
  conversionChange: number;
  averageOrderValue: number;
  aovChange: number;
}

export interface SalesByPlatform {
  platform: Platform;
  revenue: number;
  orders: number;
  averageOrderValue: number;
  percentageOfTotal: number;
}

export interface TopProduct {
  productId: string;
  title: string;
  imageUrl?: string;
  totalRevenue: number;
  totalOrders: number;
  totalUnits: number;
}

export interface RevenueSeries {
  date: string;
  total: number;
  byPlatform: Record<Platform, number>;
}

export type DateRange = '7d' | '30d' | '90d' | '12m' | 'custom';
export type Granularity = 'day' | 'week' | 'month';

// ─── Onboarding ─────────────────────────────────────────────────
export interface OnboardingSession {
  id: string;
  status: 'in_progress' | 'completed' | 'paused';
  anchorPlatform: Platform;
  targetPlatform: Platform;
  totalCandidates: number;
  matchedCount: number;
  skippedCount: number;
  rejectedCount: number;
  remainingCount: number;
  createdAt: string;
}

export interface MatchCandidate {
  id: string;
  sessionId: string;
  anchorProduct: OnboardingProduct;
  candidateProduct: OnboardingProduct;
  aiConfidence: number;
  aiReasoning: string;
  matchAttributes: string[];
  status: 'pending' | 'accepted' | 'rejected' | 'skipped';
}

export interface OnboardingProduct {
  platformProductId: string;
  platform: Platform;
  title: string;
  description?: string;
  imageUrl?: string;
  images: string[];
  price: number;
  currency: string;
  sku?: string;
  stockQuantity?: number;
  attributes: Record<string, string>;
  category?: string;
}

export interface OnboardingSummary {
  sessionId: string;
  totalProcessed: number;
  matched: number;
  skipped: number;
  rejected: number;
  matchRate: number;
  productsCreated: number;
  nextSteps: string[];
}

export type SwipeAction = 'accept' | 'reject' | 'skip';

// ─── AI Assistant ───────────────────────────────────────────────
export interface AiConversation {
  id: string;
  contextType: 'onboarding' | 'products' | 'analytics' | 'pricing' | 'general';
  messages: AiMessage[];
  createdAt: string;
}

export interface AiMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

// ─── Pagination ─────────────────────────────────────────────────
export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// ─── API Error ──────────────────────────────────────────────────
export interface ApiError {
  statusCode: number;
  message: string;
  error?: string;
}
