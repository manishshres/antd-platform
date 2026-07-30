import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  integer,
  boolean,
  jsonb,
  text,
  primaryKey,
  index,
  unique,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const organizations = pgTable(
  'organizations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: varchar('name', { length: 255 }).notNull(),
    slug: varchar('slug', { length: 255 }),
    status: varchar('status', { length: 50 }).default('draft').notNull(),
    webhookApiKey: varchar('webhook_api_key', { length: 255 }),
    brandingLogoUrl: varchar('branding_logo_url', { length: 1024 }),
    brandingColor: varchar('branding_color', { length: 50 }),
    settings: jsonb('settings'),
    featureFlags: jsonb('feature_flags').default({}).notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    check(
      'organizations_status_check',
      sql`${t.status} IN ('draft', 'active', 'suspended', 'archived', 'provisioning')`,
    ),
  ],
);

export const locations = pgTable(
  'locations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .references(() => organizations.id, { onDelete: 'cascade' })
      .notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    slug: varchar('slug', { length: 255 }).notNull(),
    // Address fields
    address: varchar('address', { length: 500 }),
    city: varchar('city', { length: 255 }),
    state: varchar('state', { length: 100 }),
    country: varchar('country', { length: 10 }).default('US').notNull(),
    postalCode: varchar('postal_code', { length: 20 }),
    // ISO 4217 currency for every money column belonging to this location (N8). All amounts
    // are stored as integer minor units; this says which currency those units are in, which
    // was previously USD-implicit everywhere. Formatting/rounding for zero-decimal
    // currencies (JPY, KRW) is not handled yet — see the currency helper before adding one.
    currency: varchar('currency', { length: 3 }).default('USD').notNull(),
    timezone: varchar('timezone', { length: 100 }).default('America/New_York'),
    businessHours: jsonb('business_hours'),
    aiSettings: jsonb('ai_settings'),
    // Sales tax rate in basis points (825 = 8.25%). Single flat rate per location for now;
    // a tax_rates table replaces this when per-item/channel rules are needed (see POS plan).
    taxRateBps: integer('tax_rate_bps').default(0).notNull(),
    // Optional auto-gratuity/service-charge rate in basis points (1800 = 18%). The POS offers
    // it as an opt-in toggle at checkout rather than always applying it; 0 means unused.
    serviceChargeBps: integer('service_charge_bps').default(0).notNull(),
    // Per-location printing behavior: { kitchenEnabled, kitchenCopies, receiptEnabled,
    // receiptCopies }. Null = defaults (both enabled, 1 copy each).
    printSettings: jsonb('print_settings'),
    // Telnyx provisioning (per-location)
    phoneNumber: varchar('phone_number', { length: 50 }),
    telnyxPhoneNumberId: varchar('telnyx_phone_number_id', { length: 255 }),
    telnyxAssistantId: varchar('telnyx_assistant_id', { length: 255 }),
    // When the menu was last published to this location's Telnyx AI knowledge base. Null until the
    // first sync. Lets the UI show freshness and lets auto-sync target already-published locations.
    menuLastSyncedAt: timestamp('menu_last_synced_at', { withTimezone: true }),
    masterAgentId: varchar('master_agent_id', { length: 255 }),
    // Provisioning state
    status: varchar('status', { length: 50 }).default('draft').notNull(),
    provisioningError: varchar('provisioning_error', { length: 2048 }),
    provisioningStartedAt: timestamp('provisioning_started_at', {
      withTimezone: true,
    }),
    provisioningCompletedAt: timestamp('provisioning_completed_at', {
      withTimezone: true,
    }),
    // Webhook
    webhookApiKey: varchar('webhook_api_key', { length: 255 }),
    // Menu Sync
    menuImportSource: varchar('menu_import_source', { length: 1024 }),
    // Soft delete
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index('idx_locations_organization_id').on(t.organizationId),
    check(
      'locations_status_check',
      sql`${t.status} IN ('draft', 'active', 'suspended', 'archived', 'deprovisioned', 'provisioning')`,
    ),
    // ISO 4217 is exactly three uppercase letters (N8).
    check('locations_currency_check', sql`${t.currency} ~ '^[A-Z]{3}$'`),
  ],
);

export const orgInvitations = pgTable(
  'org_invitations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .references(() => organizations.id, { onDelete: 'cascade' })
      .notNull(),
    locationId: uuid('location_id').references(() => locations.id, {
      onDelete: 'cascade',
    }),
    email: varchar('email', { length: 255 }).notNull(),
    // Default to the least-privileged org role, not the highest (M4).
    role: varchar('role', { length: 50 }).default('manager').notNull(),
    tokenHash: varchar('token_hash', { length: 255 }).notNull().unique(),
    status: varchar('status', { length: 50 }).default('pending').notNull(),
    // 'pending' | 'accepted' | 'expired' | 'revoked'
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    invitedByUserId: uuid('invited_by_user_id'), // Will reference users.id below
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index('idx_org_invitations_organization_id').on(t.organizationId),
    index('idx_org_invitations_email').on(t.email),
    check(
      'org_invitations_role_check',
      sql`${t.role} IN ('user', 'manager', 'admin', 'sysadmin', 'platform_admin')`,
    ),
    check(
      'org_invitations_status_check',
      sql`${t.status} IN ('pending', 'accepted', 'expired', 'revoked')`,
    ),
  ],
);

export const orgProvisioningSteps = pgTable(
  'org_provisioning_steps',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    locationId: uuid('location_id')
      .references(() => locations.id, { onDelete: 'cascade' })
      .notNull(),
    organizationId: uuid('organization_id')
      .references(() => organizations.id, { onDelete: 'cascade' })
      .notNull(),
    stepName: varchar('step_name', { length: 100 }).notNull(),
    stepOrder: integer('step_order').notNull(),
    status: varchar('status', { length: 50 }).default('pending').notNull(),
    // 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped'
    attempts: integer('attempts').default(0).notNull(),
    lastError: varchar('last_error', { length: 2048 }),
    metadata: jsonb('metadata'), // stores IDs, phone numbers, etc. from each step
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index('idx_provisioning_steps_location_id').on(t.locationId),
    index('idx_provisioning_steps_organization_id').on(t.organizationId),
  ],
);

export const users = pgTable(
  'users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    email: varchar('email', { length: 255 }).notNull().unique(),
    passwordHash: varchar('password_hash', { length: 255 }).notNull(),
    role: varchar('role', { length: 50 }).default('manager').notNull(), // 'platform_admin' | 'sysadmin' | 'manager'
    firstName: varchar('first_name', { length: 255 }),
    lastName: varchar('last_name', { length: 255 }),
    phoneNumber: varchar('phone_number', { length: 50 }),
    companyName: varchar('company_name', { length: 255 }),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    onboardingCompletedAt: timestamp('onboarding_completed_at', {
      withTimezone: true,
    }),
    failedLoginAttempts: integer('failed_login_attempts').default(0).notNull(),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    organizationId: uuid('organization_id').references(() => organizations.id, {
      onDelete: 'set null',
    }),
    locationId: uuid('location_id').references(() => locations.id, {
      onDelete: 'set null',
    }),
    posPinHash: varchar('pos_pin_hash', { length: 255 }),
    // POS PIN brute-force protection (N3). Kept separate from the password
    // lockout above so a PIN attack can't lock the user out of the dashboard.
    posPinFailedAttempts: integer('pos_pin_failed_attempts')
      .default(0)
      .notNull(),
    posPinLockedUntil: timestamp('pos_pin_locked_until', {
      withTimezone: true,
    }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index('idx_users_email').on(t.email),
    index('idx_users_organization_id').on(t.organizationId),
    index('idx_users_location_id').on(t.locationId),
    check(
      'users_role_check',
      sql`${t.role} IN ('user', 'manager', 'admin', 'sysadmin', 'platform_admin')`,
    ),
  ],
);

export const timeClockEntries = pgTable(
  'time_clock_entries',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .references(() => organizations.id, { onDelete: 'cascade' })
      .notNull(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    locationId: uuid('location_id').references(() => locations.id, {
      onDelete: 'set null',
    }),
    clockInAt: timestamp('clock_in_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    // Null while the shift is open. At most one open (null) entry per user is
    // enforced in the service layer, not the DB, so it stays a plain nullable column.
    clockOutAt: timestamp('clock_out_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index('idx_time_clock_entries_org').on(t.organizationId),
    index('idx_time_clock_entries_user').on(t.userId),
  ],
);

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    token: varchar('token', { length: 512 }).notNull().unique(), // Holds SHA-256 hash of refresh token
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    /** TTL in seconds chosen at login (rememberMe or default). Preserved across rotations (M2). */
    ttlSecs: integer('ttl_secs').notNull().default(604800),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [index('idx_refresh_tokens_user_id').on(t.userId)],
);

export const plans = pgTable('plans', {
  id: varchar('id', { length: 50 }).primaryKey(), // 'free', 'growth', 'enterprise'
  name: varchar('name', { length: 100 }).notNull(),
  priceId: varchar('price_id', { length: 255 }), // Stripe price ID (null for free plan)
  voiceAgentsLimit: integer('voice_agents_limit').notNull(),
  monthlyMinutesLimit: integer('monthly_minutes_limit').notNull(),
  phoneNumbersLimit: integer('phone_numbers_limit').notNull(),
  kbSizeLimit: integer('kb_size_limit').notNull(), // in MB
  websiteImportsLimit: integer('website_imports_limit').notNull(),
  orderVolumeLimit: integer('order_volume_limit').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const subscriptions = pgTable(
  'subscriptions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .references(() => organizations.id, { onDelete: 'cascade' })
      .notNull(),
    locationId: uuid('location_id').references(() => locations.id, {
      onDelete: 'cascade',
    }),
    planId: varchar('plan_id', { length: 50 })
      .references(() => plans.id)
      .notNull(),
    stripeSubscriptionId: varchar('stripe_subscription_id', {
      length: 255,
    }).unique(),
    stripeCustomerId: varchar('stripe_customer_id', { length: 255 }),
    status: varchar('status', { length: 50 }).notNull(), // 'active', 'trialing', 'past_due', 'canceled', etc.
    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
    cancelAtPeriodEnd: boolean('cancel_at_period_end').default(false).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index('idx_subscriptions_organization_id').on(t.organizationId),
    index('idx_subscriptions_location_id').on(t.locationId),
  ],
);

export const apiKeys = pgTable(
  'api_keys',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .references(() => organizations.id, { onDelete: 'cascade' })
      .notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    keyHash: varchar('key_hash', { length: 255 }).notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [index('idx_api_keys_organization_id').on(t.organizationId)],
);

export const categories = pgTable(
  'categories',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: varchar('name', { length: 255 }).notNull(),
    organizationId: uuid('organization_id')
      .references(() => organizations.id, { onDelete: 'cascade' })
      .notNull(),
    locationId: uuid('location_id').references(() => locations.id, {
      onDelete: 'cascade',
    }),
    isAvailable: boolean('is_available').default(true).notNull(),
    sortOrder: integer('sort_order').default(0).notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index('idx_categories_organization_id').on(t.organizationId),
    index('idx_categories_location_id').on(t.locationId),
  ],
);

export const menuItems = pgTable(
  'menu_items',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: varchar('name', { length: 255 }).notNull(),
    description: varchar('description', { length: 1024 }),
    price: integer('price').notNull(), // in cents
    categoryId: uuid('category_id')
      .references(() => categories.id, { onDelete: 'cascade' })
      .notNull(),
    locationId: uuid('location_id').references(() => locations.id, {
      onDelete: 'cascade',
    }),
    isAvailable: boolean('is_available').default(true).notNull(),
    // Pinned to the POS ⭐ Favorites strip — most restaurants ring up the same 20-30 items.
    isFavorite: boolean('is_favorite').default(false).notNull(),
    imageUrl: varchar('image_url', { length: 1024 }),
    sortOrder: integer('sort_order').default(0).notNull(),
    availabilitySchedule: jsonb('availability_schedule'), // e.g. [{ day: 1, startTime: '09:00', endTime: '17:00' }]
    // Retail checkout: barcode/SKU the POS camera scanner matches against. Nullable —
    // most restaurant menu items are never scanned.
    sku: varchar('sku', { length: 64 }),
    // Combo/bundle meal: components are modeled as its required modifier groups
    // (e.g. "Choose a Side"), reusing the existing modifier pricing/validation engine.
    // This flag only changes how the POS presents the item (combo builder vs. simple customize).
    isCombo: boolean('is_combo').default(false).notNull(),
    // Excluded from tax calculation (e.g. unprepared grocery items in some jurisdictions).
    taxExempt: boolean('tax_exempt').default(false).notNull(),
    stockQuantity: integer('stock_quantity'),
    lowStockThreshold: integer('low_stock_threshold'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index('idx_menu_items_category_id').on(t.categoryId),
    index('idx_menu_items_location_id').on(t.locationId),
    index('idx_menu_items_sku').on(t.sku),
  ],
);

export const menuModifiers = pgTable(
  'menu_modifiers',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: varchar('name', { length: 255 }).notNull(),
    organizationId: uuid('organization_id')
      .references(() => organizations.id, { onDelete: 'cascade' })
      .notNull(),
    locationId: uuid('location_id').references(() => locations.id, {
      onDelete: 'cascade',
    }),
    isRequired: boolean('is_required').default(false).notNull(),
    multiSelect: boolean('multi_select').default(false).notNull(),
    maxSelections: integer('max_selections'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index('idx_menu_modifiers_organization_id').on(t.organizationId),
    index('idx_menu_modifiers_location_id').on(t.locationId),
  ],
);

export const menuItemModifiers = pgTable('menu_item_modifiers', {
  id: uuid('id').defaultRandom().primaryKey(),
  modifierId: uuid('modifier_id')
    .references(() => menuModifiers.id, { onDelete: 'cascade' })
    .notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  priceAdjustment: integer('price_adjustment').default(0).notNull(), // in cents
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const menuItemToModifiers = pgTable(
  'menu_item_to_modifiers',
  {
    menuItemId: uuid('menu_item_id')
      .references(() => menuItems.id, { onDelete: 'cascade' })
      .notNull(),
    modifierId: uuid('modifier_id')
      .references(() => menuModifiers.id, { onDelete: 'cascade' })
      .notNull(),
  },
  (t) => [primaryKey({ columns: [t.menuItemId, t.modifierId] })],
);

export const categoryToModifiers = pgTable(
  'category_to_modifiers',
  {
    categoryId: uuid('category_id')
      .references(() => categories.id, { onDelete: 'cascade' })
      .notNull(),
    modifierId: uuid('modifier_id')
      .references(() => menuModifiers.id, { onDelete: 'cascade' })
      .notNull(),
  },
  (t) => [primaryKey({ columns: [t.categoryId, t.modifierId] })],
);

export const discounts = pgTable(
  'discounts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .references(() => organizations.id, { onDelete: 'cascade' })
      .notNull(),
    locationId: uuid('location_id').references(() => locations.id, {
      onDelete: 'cascade',
    }),
    name: varchar('name', { length: 255 }).notNull(),
    // Optional promo code customers/cashiers can type ("LUNCH10"). Null = button-only discount.
    code: varchar('code', { length: 50 }),
    type: varchar('type', { length: 10 }).notNull(), // 'percent' | 'fixed'
    // percent: whole percent (10 = 10%); fixed: cents off the subtotal.
    value: integer('value').notNull(),
    // Requires a manager/admin role to apply (e.g. "Manager Discount", "Employee Meal").
    requiresManager: boolean('requires_manager').default(false).notNull(),
    active: boolean('active').default(true).notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index('idx_discounts_organization_id').on(t.organizationId),
    check('discounts_type_check', sql`${t.type} IN ('percent', 'fixed')`),
    check('discounts_value_check', sql`${t.value} >= 0`),
  ],
);
export const customers = pgTable(
  'customers',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .references(() => organizations.id, { onDelete: 'cascade' })
      .notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    phone: varchar('phone', { length: 50 }),
    email: varchar('email', { length: 255 }),
    notes: text('notes'),
    // Simple cash-back-style loyalty balance: 1 point earned per dollar spent (paid POS
    // orders only), 1 point = 1 cent redeemable toward a future order. See
    // OrdersService.createPosOrder for the accrual/redemption math.
    loyaltyPoints: integer('loyalty_points').default(0).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('idx_customers_org').on(table.organizationId),
    index('idx_customers_phone').on(table.phone),
  ],
);
export const floorPlans = pgTable(
  'floor_plans',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .references(() => organizations.id, { onDelete: 'cascade' })
      .notNull(),
    locationId: uuid('location_id')
      .references(() => locations.id, { onDelete: 'cascade' })
      .notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    width: integer('width').default(1000).notNull(),
    height: integer('height').default(1000).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('idx_floor_plans_org').on(table.organizationId),
    index('idx_floor_plans_location').on(table.locationId),
  ],
);

export const tables = pgTable(
  'tables',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .references(() => organizations.id, { onDelete: 'cascade' })
      .notNull(),
    floorPlanId: uuid('floor_plan_id')
      .references(() => floorPlans.id, { onDelete: 'cascade' })
      .notNull(),
    name: varchar('name', { length: 50 }).notNull(),
    capacity: integer('capacity').default(4).notNull(),
    posX: integer('pos_x').default(0).notNull(),
    posY: integer('pos_y').default(0).notNull(),
    shape: varchar('shape', { length: 50 }).default('rectangle').notNull(), // 'rectangle', 'circle'
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('idx_tables_org').on(table.organizationId),
    index('idx_tables_floor_plan').on(table.floorPlanId),
  ],
);

export const orders = pgTable(
  'orders',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .references(() => organizations.id, { onDelete: 'cascade' })
      .notNull(),
    locationId: uuid('location_id').references(() => locations.id, {
      onDelete: 'cascade',
    }),
    customerId: uuid('customer_id').references(() => customers.id, {
      onDelete: 'set null',
    }),
    tableId: uuid('table_id').references(() => tables.id, {
      onDelete: 'set null',
    }),
    customerName: varchar('customer_name', { length: 255 }).notNull(),
    customerPhone: varchar('customer_phone', { length: 50 }).notNull(),
    status: varchar('status', { length: 50 }).default('pending').notNull(), // 'pending', 'preparing', 'ready', 'completed', 'cancelled'
    totalAmount: integer('total_amount').notNull(), // in cents, subtotal + tax
    // Tax breakdown (cents). Nullable so pre-tax rows stay valid; totalAmount remains the
    // single source of truth for what was charged.
    subtotal: integer('subtotal'),
    taxAmount: integer('tax_amount'),
    // Tender extras (cents). Discount reduces the taxable base; tip is added after tax.
    // discountName snapshots the applied discount so receipts survive later edits;
    // discountId lets the register rehydrate the selection when re-editing an unpaid order.
    tipAmount: integer('tip_amount'),
    // Auto-gratuity/service charge (cents), applied at the taxable base like a taxed line
    // item rather than a tip — see OrdersService.createPosOrder.
    serviceChargeAmount: integer('service_charge_amount'),
    // Loyalty: points redeemed reduce the amount due 1:1 with cents; points earned accrue
    // only on orders paid at creation (see OrdersService.createPosOrder).
    loyaltyPointsEarned: integer('loyalty_points_earned'),
    loyaltyPointsRedeemed: integer('loyalty_points_redeemed'),
    discountAmount: integer('discount_amount'),
    discountName: varchar('discount_name', { length: 255 }),
    discountId: uuid('discount_id').references(() => discounts.id, {
      onDelete: 'set null',
    }),
    // Fulfilment type (e.g. 'pickup', 'delivery', 'dine_in') and free-form kitchen notes captured
    // from the AI order webhook. Kept nullable/permissive so a novel value never drops an order.
    orderType: varchar('order_type', { length: 50 }),
    specialInstructions: varchar('special_instructions', { length: 1000 }),
    // POS support: which channel created the order ('pos' | 'ai_phone' | 'online'), how it was
    // paid ('cash' | 'card' — detailed payment processing lands later), and when. Nullable so
    // pre-POS rows and the AI webhook path stay valid without a backfill.
    source: varchar('source', { length: 20 }),
    // Normalized channel FK (aggregator). Superset of `source`: also covers marketplace
    // channels (kitchenhub/doordash/...). `source` varchar is kept populated for backward
    // compatibility with existing reporting/public API; new code should prefer sourceId.
    sourceId: uuid('source_id').references(() => orderSources.id, {
      onDelete: 'set null',
    }),
    // Aggregator: the marketplace integration this order arrived through, and the marketplace's
    // own order id. Nullable — native POS/AI orders leave these unset.
    integrationAccountId: uuid('integration_account_id').references(
      () => integrationAccounts.id,
      { onDelete: 'set null' },
    ),
    externalOrderId: varchar('external_order_id', { length: 255 }),
    paymentMethod: varchar('payment_method', { length: 20 }),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    // Human-friendly per-location daily sequence ("Order #47") for tickets and callouts.
    ticketNumber: integer('ticket_number'),
    clientOrderId: varchar('client_order_id', { length: 255 }),
    // How this order reaches the kitchen. 'all' (default) prints every line on
    // the normal save/update events — the behaviour every non-dine-in order
    // has always had. 'by_course' suppresses that and prints one ticket per
    // course as the register fires it.
    fireMode: varchar('fire_mode', { length: 20 }).default('all').notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index('idx_orders_organization_id').on(t.organizationId),
    index('idx_orders_location_id').on(t.locationId),
    // M11: composite index for tenant-scoped paginated order lists
    index('idx_orders_org_created').on(t.organizationId, t.createdAt),
    unique('idx_orders_org_client_id').on(t.organizationId, t.clientOrderId),
    check(
      'orders_status_check',
      sql`${t.status} IN ('pending', 'confirmed', 'preparing', 'ready', 'completed', 'cancelled', 'refunded')`,
    ),
    // Tips are never negative (P4-006). NULL is still allowed (no tip recorded).
    check('orders_tip_amount_check', sql`${t.tipAmount} >= 0`),
    check('orders_fire_mode_check', sql`${t.fireMode} IN ('all', 'by_course')`),
  ],
);

export const orderItems = pgTable(
  'order_items',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orderId: uuid('order_id')
      .references(() => orders.id, { onDelete: 'cascade' })
      .notNull(),
    menuItemId: uuid('menu_item_id')
      .references(() => menuItems.id, { onDelete: 'cascade' })
      .notNull(),
    quantity: integer('quantity').notNull(),
    price: integer('price').notNull(), // unit price in cents at time of order, incl. modifiers
    // Snapshot of selected modifier options at order time — menu edits must never mutate
    // historical orders. Shape: [{ modifier, option, priceAdjustment }]
    modifiers: jsonb('modifiers'),
    notes: varchar('notes', { length: 500 }),
    // Which wave this line goes out in: 1 Apps, 2 Mains, 3 Dessert. Null means
    // the line isn't coursed and rides the order's normal kitchen ticket.
    course: integer('course'),
    // When this line was actually sent to the kitchen. Null = not yet fired.
    // Only meaningful on orders with fireMode = 'by_course'.
    firedAt: timestamp('fired_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index('idx_order_items_order_id').on(t.orderId),
    // FK cascade + cashier/menu reporting want this covered (P4-013).
    index('idx_order_items_menu_item_id').on(t.menuItemId),
    // Order lines are always for a positive quantity at a non-negative price
    // (P4-030 / P4-031).
    check('order_items_quantity_check', sql`${t.quantity} > 0`),
    check('order_items_price_check', sql`${t.price} >= 0`),
  ],
);

/**
 * Idempotency ledger for mutations against an existing order — today the POS
 * appending items to an open tab. The register mints the key on-device and
 * replays it after a dropped response, so the unique constraint (not the
 * check-then-insert) is what actually prevents a double-append; see the
 * clientOrderId convention on `orders` for the create-side equivalent.
 */
export const orderMutations = pgTable(
  'order_mutations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .references(() => organizations.id, { onDelete: 'cascade' })
      .notNull(),
    orderId: uuid('order_id')
      .references(() => orders.id, { onDelete: 'cascade' })
      .notNull(),
    clientMutationId: varchar('client_mutation_id', { length: 255 }).notNull(),
    kind: varchar('kind', { length: 20 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index('idx_order_mutations_order_id').on(t.orderId),
    unique('idx_order_mutations_org_client_id').on(
      t.organizationId,
      t.clientMutationId,
    ),
  ],
);

/**
 * Partial payments against an order (split checks, cash handling). An order is
 * paid when sum(amount) >= orders.totalAmount; orders.paymentMethod becomes
 * 'split' when methods differ. Drawer reporting (Phase 3) reads this table.
 */
export const payments = pgTable(
  'payments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .references(() => organizations.id, { onDelete: 'cascade' })
      .notNull(),
    locationId: uuid('location_id').references(() => locations.id, {
      onDelete: 'cascade',
    }),
    orderId: uuid('order_id')
      .references(() => orders.id, { onDelete: 'cascade' })
      .notNull(),
    method: varchar('method', { length: 20 }).notNull(), // 'cash' | 'card' | 'gift_card' | 'store_credit' | 'other'
    /** Cents applied toward the order total. */
    amount: integer('amount').notNull(),
    /** Tip carried by this payment (added to the order total when recorded). */
    tipAmount: integer('tip_amount').default(0).notNull(),
    /** Cash only: what the customer handed over / what was returned. */
    cashReceived: integer('cash_received'),
    changeGiven: integer('change_given'),
    createdBy: uuid('created_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index('idx_payments_order_id').on(t.orderId),
    index('idx_payments_organization_id').on(t.organizationId),
    // Cashier reports group by who took the payment; index the FK (P4-014).
    index('idx_payments_created_by').on(t.createdBy),
    check(
      'payments_method_check',
      sql`${t.method} IN ('cash', 'card', 'gift_card', 'store_credit', 'other')`,
    ),
    check('payments_amount_check', sql`${t.amount} != 0`),
  ],
);

export const printJobs = pgTable(
  'print_jobs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .references(() => organizations.id, { onDelete: 'cascade' })
      .notNull(),
    locationId: uuid('location_id').references(() => locations.id, {
      onDelete: 'cascade',
    }),
    orderId: uuid('order_id').references(() => orders.id, {
      onDelete: 'cascade',
    }),
    jobType: varchar('job_type', { length: 50 }).notNull(),
    status: varchar('status', { length: 50 }).default('queued').notNull(),
    printerId: varchar('printer_id', { length: 255 }),
    attempts: integer('attempts').default(0).notNull(),
    lastError: varchar('last_error', { length: 1024 }),
    payload: jsonb('payload').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index('idx_print_jobs_organization_id').on(t.organizationId),
    index('idx_print_jobs_location_id').on(t.locationId),
    index('idx_print_jobs_order_id').on(t.orderId),
  ],
);

// Audit log table
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id').references(() => organizations.id, {
      onDelete: 'cascade',
    }),
    userId: uuid('user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    action: varchar('action', { length: 100 }).notNull(), // e.g. 'user.create', 'auth.login'
    entityType: varchar('entity_type', { length: 100 }), // e.g. 'user', 'menu_item'
    entityId: uuid('entity_id'),
    previousValue: jsonb('previous_value'),
    newValue: jsonb('new_value'),
    ipAddress: varchar('ip_address', { length: 45 }),
    userAgent: varchar('user_agent', { length: 500 }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index('idx_audit_logs_organization_id').on(t.organizationId),
    index('idx_audit_logs_created_at').on(t.createdAt),
    // M11: composite index for tenant-scoped audit log queries
    index('idx_audit_logs_org_created').on(t.organizationId, t.createdAt),
  ],
);

// Agent-to-org mapping (for white-labeling + org scoping)
export const orgAgents = pgTable(
  'org_agents',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .references(() => organizations.id, { onDelete: 'cascade' })
      .notNull(),
    locationId: uuid('location_id').references(() => locations.id, {
      onDelete: 'cascade',
    }),
    externalId: varchar('external_id', { length: 255 }).notNull(), // Telnyx assistant ID
    name: varchar('name', { length: 255 }).notNull(),
    status: varchar('status', { length: 50 }).default('active'),
    config: jsonb('config'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index('idx_org_agents_organization_id').on(t.organizationId),
    index('idx_org_agents_location_id').on(t.locationId),
  ],
);

// Document-to-org mapping (for knowledge bases)
export const orgDocuments = pgTable(
  'org_documents',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .references(() => organizations.id, { onDelete: 'cascade' })
      .notNull(),
    externalId: varchar('external_id', { length: 255 }).notNull(), // Telnyx document ID
    filename: varchar('filename', { length: 255 }).notNull(),
    mimeType: varchar('mime_type', { length: 100 }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [index('idx_org_documents_organization_id').on(t.organizationId)],
);

// Phone number-to-org mapping (for voice call routing)
export const orgPhoneNumbers = pgTable(
  'org_phone_numbers',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .references(() => organizations.id, { onDelete: 'cascade' })
      .notNull(),
    locationId: uuid('location_id').references(() => locations.id, {
      onDelete: 'cascade',
    }),
    phoneNumber: varchar('phone_number', { length: 50 }).notNull(),
    externalId: varchar('external_id', { length: 255 }), // Telnyx phone number ID
    name: varchar('name', { length: 255 }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index('idx_org_phone_numbers_organization_id').on(t.organizationId),
    index('idx_org_phone_numbers_location_id').on(t.locationId),
  ],
);

// Registered printers per organization (Phase 6)
export const printers = pgTable(
  'printers',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .references(() => organizations.id, { onDelete: 'cascade' })
      .notNull(),
    locationId: uuid('location_id').references(() => locations.id, {
      onDelete: 'cascade',
    }),
    name: varchar('name', { length: 255 }).notNull(),
    /** MQTT command topic this printer subscribes to */
    topic: varchar('topic', { length: 255 }).notNull(),
    /** 'kitchen' | 'receipt' | 'label' */
    type: varchar('type', { length: 50 }).notNull().default('kitchen'),
    locationName: varchar('location_name', { length: 255 }),
    isOnline: boolean('is_online').default(false).notNull(),
    lastHeartbeatAt: timestamp('last_heartbeat_at', { withTimezone: true }),
    ipAddress: varchar('ip_address', { length: 45 }),
    model: varchar('model', { length: 100 }),
    notes: varchar('notes', { length: 500 }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index('idx_printers_organization_id').on(t.organizationId),
    index('idx_printers_location_id').on(t.locationId),
  ],
);

// Password reset tokens — time-limited, single-use (Phase 7)
export const passwordResetTokens = pgTable('password_reset_tokens', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  /** SHA-256 hash of the raw token sent in the email */
  tokenHash: varchar('token_hash', { length: 255 }).notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  /** Set when consumed — prevents reuse */
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// Email verification tokens — single-use (Phase 7)
export const emailVerificationTokens = pgTable('email_verification_tokens', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  /** SHA-256 hash of the raw token sent in the email */
  tokenHash: varchar('token_hash', { length: 255 }).notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// Call Recordings & Transcripts (Phase 11)
export const recordings = pgTable(
  'recordings',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .references(() => organizations.id, { onDelete: 'cascade' })
      .notNull(),
    locationId: uuid('location_id')
      .references(() => locations.id, { onDelete: 'cascade' })
      .notNull(),
    callSessionId: varchar('call_session_id', { length: 255 })
      .unique()
      .notNull(),
    fromNumber: varchar('from_number', { length: 50 }),
    toNumber: varchar('to_number', { length: 50 }),
    objectKey: varchar('object_key', { length: 1024 }),
    durationMs: integer('duration_ms'),
    transcript: text('transcript'),
    aiSummary: text('ai_summary'),
    sentiment: varchar('sentiment', { length: 50 }),
    callOutcome: varchar('call_outcome', { length: 255 }),
    tags: jsonb('tags'), // Array of tags
    status: varchar('status', { length: 50 }).default('pending').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index('idx_recordings_organization_id').on(t.organizationId),
    index('idx_recordings_location_id').on(t.locationId),
    // M11: composite index for tenant-scoped recording lists
    index('idx_recordings_org_created').on(t.organizationId, t.createdAt),
    index('idx_recordings_fts').using(
      'gin',
      sql`to_tsvector('english', coalesce(${t.transcript}, '') || ' ' || coalesce(${t.aiSummary}, ''))`,
    ),
  ],
);

// Chat Conversations (Phase 11)
export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .references(() => organizations.id, { onDelete: 'cascade' })
      .notNull(),
    locationId: uuid('location_id')
      .references(() => locations.id, { onDelete: 'cascade' })
      .notNull(),
    callSessionId: varchar('call_session_id', { length: 255 }).notNull(),
    messages: jsonb('messages').notNull(), // Array of { role, text, sentAt }
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index('idx_conversations_organization_id').on(t.organizationId),
    index('idx_conversations_location_id').on(t.locationId),
  ],
);

// Tenant-Level Usage Tracking (Phase 12)
export const usageEvents = pgTable(
  'usage_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .references(() => organizations.id, { onDelete: 'cascade' })
      .notNull(),
    locationId: uuid('location_id')
      .references(() => locations.id, { onDelete: 'cascade' })
      .notNull(),
    eventType: varchar('event_type', { length: 100 }).notNull(), // e.g. 'call_minutes', 'call_count', 'sms_count', 'storage_kb', 'api_request', 'ai_summary', 'ai_transcription'
    amount: integer('amount').notNull(), // amount of usage (e.g. minutes, bytes, or count)
    metadata: jsonb('metadata'), // e.g. { callSessionId: "..." }
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index('idx_usage_events_organization_id').on(t.organizationId),
    index('idx_usage_events_location_id').on(t.locationId),
    // M11: composite index for billing aggregation queries
    index('idx_usage_events_org_type_created').on(
      t.organizationId,
      t.eventType,
      t.createdAt,
    ),
  ],
);

export const orgWebhooks = pgTable(
  'org_webhooks',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .references(() => organizations.id, { onDelete: 'cascade' })
      .notNull(),
    url: varchar('url', { length: 1024 }).notNull(),
    events: jsonb('events').notNull(), // array of strings e.g. ['order.created', 'order.updated']
    isActive: boolean('is_active').default(true).notNull(),
    secret: varchar('secret', { length: 255 }).notNull(), // HMAC signature secret
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [index('idx_org_webhooks_organization_id').on(t.organizationId)],
);

// Idempotency tracking for incoming webhooks
export const webhookEvents = pgTable('webhook_events', {
  eventId: varchar('event_id', { length: 255 }).primaryKey(),
  provider: varchar('provider', { length: 50 }).notNull(),
  status: varchar('status', { length: 50 }).default('pending').notNull(),
  // Aggregator: the normalized event type ('order.created', 'order.updated', ...) and the
  // full raw provider payload, retained for audit/replay. Nullable — the AI/Telnyx paths
  // that predate the aggregator only reserve eventId for idempotency.
  eventType: varchar('event_type', { length: 100 }),
  payload: jsonb('payload'),
  receivedAt: timestamp('received_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  processedAt: timestamp('processed_at', { withTimezone: true }),
});

// ────────────────────────────────────────────────────────────────────────────
// Order Aggregator — provider-agnostic marketplace integration layer.
// See src/aggregator/. Marketplace orders flow: webhook → externalOrders
// (raw) → normalization → native `orders` row (source = provider). Adding a new
// marketplace (DoorDash/UberEats/Grubhub) is a new adapter + a `providers` row —
// no changes to orders/POS/kitchen/reporting.
// ────────────────────────────────────────────────────────────────────────────

/** A delivery marketplace Coneeko can integrate with (kitchenhub, doordash, ...). */
export const providers = pgTable('providers', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 255 }).notNull().unique(),
  isActive: boolean('is_active').default(true).notNull(),
});

/**
 * Feature matrix per provider. Drives runtime capability checks — the core never
 * assumes a provider supports menu sync or refunds just because the interface exists.
 */
export const providerCapabilities = pgTable(
  'provider_capabilities',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    providerId: uuid('provider_id')
      .references(() => providers.id, { onDelete: 'cascade' })
      .notNull(),
    supportsOrders: boolean('supports_orders').default(true).notNull(),
    supportsMenuSync: boolean('supports_menu_sync').default(false).notNull(),
    supportsDelivery: boolean('supports_delivery').default(false).notNull(),
    supportsStatusUpdates: boolean('supports_status_updates')
      .default(true)
      .notNull(),
    supportsRefunds: boolean('supports_refunds').default(false).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [unique('uq_provider_capabilities_provider').on(t.providerId)],
);

/**
 * A restaurant's connection to one provider (per org, optionally per location).
 * `credentials` is encrypted at rest via CredentialEncryptionService (AES-256-GCM).
 */
export const integrationAccounts = pgTable(
  'integration_accounts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .references(() => organizations.id, { onDelete: 'cascade' })
      .notNull(),
    locationId: uuid('location_id').references(() => locations.id, {
      onDelete: 'cascade',
    }),
    providerId: uuid('provider_id')
      .references(() => providers.id, { onDelete: 'cascade' })
      .notNull(),
    // Encrypted blob (never store plaintext client_id/client_secret/tokens/webhook secret).
    credentials: jsonb('credentials'),
    // The provider-side store id this account maps to (KitchenHub store_id, etc.).
    providerStoreId: varchar('provider_store_id', { length: 255 }),
    status: varchar('status', { length: 30 }).default('waiting').notNull(), // waiting_menu | in_progress | waiting | connected | rejected | disabled
    isOnline: boolean('is_online').default(false).notNull(),
    // When true (default), inbound marketplace orders are auto-accepted on the provider as
    // soon as they import. When false, the order lands pending and a cashier accepts/denies
    // it from the POS/dashboard within the provider's accept window (Uber Eats: 11.5 min).
    autoAcceptOrders: boolean('auto_accept_orders').default(true).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index('idx_integration_accounts_org').on(t.organizationId),
    index('idx_integration_accounts_provider').on(t.providerId),
  ],
);

/**
 * In-flight merchant OAuth handshakes for marketplace onboarding (Uber Eats
 * `authorization_code` grant). A row is created when we hand the merchant off to the
 * provider's login and consumed by the callback, which arrives on the merchant's browser
 * with no JWT — `state` is the only thing tying that request back to an organization, so
 * it is random, unique, single-use and short-lived.
 *
 * The resulting user access token is short-lived by design here: it exists only to list
 * the merchant's stores and provision the chosen ones, and is wiped once the session
 * completes. It is encrypted at rest like every other provider credential.
 */
export const integrationOauthSessions = pgTable(
  'integration_oauth_sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .references(() => organizations.id, { onDelete: 'cascade' })
      .notNull(),
    // Who started the handshake, for the audit trail.
    userId: uuid('user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    providerId: uuid('provider_id')
      .references(() => providers.id, { onDelete: 'cascade' })
      .notNull(),
    // Optional pre-selected location to bind the provisioned store(s) to.
    locationId: uuid('location_id').references(() => locations.id, {
      onDelete: 'cascade',
    }),
    state: varchar('state', { length: 128 }).notNull().unique(),
    // pending → authorized → completed; or failed / expired.
    status: varchar('status', { length: 20 }).default('pending').notNull(),
    // Encrypted merchant user access token (null before the callback, wiped after use).
    accessToken: jsonb('access_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', {
      withTimezone: true,
    }),
    // The store list read back from the provider, for the merchant to choose from.
    discoveredStores: jsonb('discovered_stores'),
    error: varchar('error', { length: 1000 }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index('idx_integration_oauth_sessions_org').on(t.organizationId),
    check(
      'integration_oauth_sessions_status_check',
      sql`${t.status} IN ('pending', 'authorized', 'completed', 'failed', 'expired')`,
    ),
  ],
);

/**
 * Normalized order channel (pos, ai_phone, online, kitchenhub, doordash, ...).
 * `orders.sourceId` FKs here; extensible for future channels (kiosk/QR/website)
 * without a schema change.
 */
export const orderSources = pgTable('order_sources', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 50 }).notNull().unique(),
  type: varchar('type', { length: 20 }).default('marketplace').notNull(), // 'internal' | 'marketplace'
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

/**
 * Raw marketplace order layer — the original provider record, kept verbatim for
 * reconciliation, replay of failed imports, and dispute/debug. Links to the native
 * Coneeko order once normalization succeeds.
 */
export const externalOrders = pgTable(
  'external_orders',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .references(() => organizations.id, { onDelete: 'cascade' })
      .notNull(),
    locationId: uuid('location_id').references(() => locations.id, {
      onDelete: 'cascade',
    }),
    providerId: uuid('provider_id')
      .references(() => providers.id, { onDelete: 'cascade' })
      .notNull(),
    integrationAccountId: uuid('integration_account_id').references(
      () => integrationAccounts.id,
      { onDelete: 'set null' },
    ),
    // Filled once the native order is created; null while pending/failed import.
    internalOrderId: uuid('internal_order_id').references(() => orders.id, {
      onDelete: 'set null',
    }),
    externalOrderId: varchar('external_order_id', { length: 255 }).notNull(),
    externalStatus: varchar('external_status', { length: 50 }),
    externalCreatedAt: timestamp('external_created_at', { withTimezone: true }),
    rawPayload: jsonb('raw_payload').notNull(),
    syncStatus: varchar('sync_status', { length: 20 })
      .default('pending')
      .notNull(), // 'pending' | 'imported' | 'failed'
    error: varchar('error', { length: 1000 }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index('idx_external_orders_org').on(t.organizationId),
    index('idx_external_orders_internal_order').on(t.internalOrderId),
    // Idempotency: a given marketplace order is imported at most once.
    unique('uq_external_orders_provider_external').on(
      t.providerId,
      t.externalOrderId,
    ),
  ],
);

/**
 * Maps a Coneeko menu item to its id on a provider. Coneeko is the menu source of
 * truth; this table lets adapters translate outbound menu pushes and inbound order
 * line items between Coneeko ids and provider ids.
 */
export const menuProviderMappings = pgTable(
  'menu_provider_mappings',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    providerId: uuid('provider_id')
      .references(() => providers.id, { onDelete: 'cascade' })
      .notNull(),
    integrationAccountId: uuid('integration_account_id')
      .references(() => integrationAccounts.id, { onDelete: 'cascade' })
      .notNull(),
    coneekoMenuItemId: uuid('coneeko_menu_item_id')
      .references(() => menuItems.id, { onDelete: 'cascade' })
      .notNull(),
    externalMenuItemId: varchar('external_menu_item_id', { length: 255 }),
    externalCategoryId: varchar('external_category_id', { length: 255 }),
    mappingStatus: varchar('mapping_status', { length: 20 })
      .default('pending')
      .notNull(), // 'pending' | 'mapped' | 'unmatched' | 'archived'
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index('idx_menu_provider_mappings_account').on(t.integrationAccountId),
    unique('uq_menu_provider_mappings_account_item').on(
      t.integrationAccountId,
      t.coneekoMenuItemId,
    ),
  ],
);

/** Tracks async integration jobs (menu sync, order import backfill, location sync). */
export const integrationSyncJobs = pgTable(
  'integration_sync_jobs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .references(() => organizations.id, { onDelete: 'cascade' })
      .notNull(),
    providerId: uuid('provider_id')
      .references(() => providers.id, { onDelete: 'cascade' })
      .notNull(),
    integrationAccountId: uuid('integration_account_id').references(
      () => integrationAccounts.id,
      { onDelete: 'cascade' },
    ),
    type: varchar('type', { length: 30 }).notNull(), // 'MENU_SYNC' | 'ORDER_IMPORT' | 'LOCATION_SYNC'
    status: varchar('status', { length: 20 }).default('pending').notNull(), // 'pending' | 'running' | 'completed' | 'failed'
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    error: varchar('error', { length: 1000 }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [index('idx_integration_sync_jobs_org').on(t.organizationId)],
);

/** Per-attempt audit trail for inbound webhook deliveries — proof of receipt/processing. */
export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    webhookEventId: varchar('webhook_event_id', { length: 255 }).references(
      () => webhookEvents.eventId,
      { onDelete: 'cascade' },
    ),
    attemptNumber: integer('attempt_number').default(1).notNull(),
    responseCode: integer('response_code'),
    errorMessage: varchar('error_message', { length: 1000 }),
    receivedAt: timestamp('received_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
  },
  (t) => [index('idx_webhook_deliveries_event').on(t.webhookEventId)],
);
