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
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const organizations = pgTable('organizations', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  slug: varchar('slug', { length: 255 }),
  status: varchar('status', { length: 50 }).default('draft').notNull(),
  webhookApiKey: varchar('webhook_api_key', { length: 255 }),
  brandingLogoUrl: varchar('branding_logo_url', { length: 1024 }),
  brandingColor: varchar('branding_color', { length: 50 }),
  settings: jsonb('settings'),
  featureFlags: jsonb('feature_flags').default({}).notNull(),
  deletedAt: timestamp('deleted_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  check('organizations_status_check', sql`${t.status} IN ('draft', 'active', 'suspended', 'archived', 'provisioning')`)
]);

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
    timezone: varchar('timezone', { length: 100 }).default('America/New_York'),
    businessHours: jsonb('business_hours'),
    aiSettings: jsonb('ai_settings'),
    // Telnyx provisioning (per-location)
    phoneNumber: varchar('phone_number', { length: 50 }),
    telnyxPhoneNumberId: varchar('telnyx_phone_number_id', { length: 255 }),
    telnyxAssistantId: varchar('telnyx_assistant_id', { length: 255 }),
    // When the menu was last published to this location's Telnyx AI knowledge base. Null until the
    // first sync. Lets the UI show freshness and lets auto-sync target already-published locations.
    menuLastSyncedAt: timestamp('menu_last_synced_at'),
    masterAgentId: varchar('master_agent_id', { length: 255 }),
    // Provisioning state
    status: varchar('status', { length: 50 }).default('draft').notNull(),
    provisioningError: varchar('provisioning_error', { length: 2048 }),
    provisioningStartedAt: timestamp('provisioning_started_at'),
    provisioningCompletedAt: timestamp('provisioning_completed_at'),
    // Webhook
    webhookApiKey: varchar('webhook_api_key', { length: 255 }),
    // Menu Sync
    menuImportSource: varchar('menu_import_source', { length: 1024 }),
    // Soft delete
    deletedAt: timestamp('deleted_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => [
    index('idx_locations_organization_id').on(t.organizationId),
    check('locations_status_check', sql`${t.status} IN ('draft', 'active', 'suspended', 'archived', 'deprovisioned', 'provisioning')`)
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
    expiresAt: timestamp('expires_at').notNull(),
    acceptedAt: timestamp('accepted_at'),
    invitedByUserId: uuid('invited_by_user_id'), // Will reference users.id below
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [
    index('idx_org_invitations_organization_id').on(t.organizationId),
    index('idx_org_invitations_email').on(t.email),
    check('org_invitations_role_check', sql`${t.role} IN ('user', 'manager', 'admin', 'sysadmin', 'platform_admin')`),
    check('org_invitations_status_check', sql`${t.status} IN ('pending', 'accepted', 'expired', 'revoked')`)
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
    startedAt: timestamp('started_at'),
    completedAt: timestamp('completed_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
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
    emailVerifiedAt: timestamp('email_verified_at'),
    onboardingCompletedAt: timestamp('onboarding_completed_at'),
    failedLoginAttempts: integer('failed_login_attempts').default(0).notNull(),
    lockedUntil: timestamp('locked_until'),
    lastLoginAt: timestamp('last_login_at'),
    organizationId: uuid('organization_id').references(() => organizations.id, {
      onDelete: 'set null',
    }),
    locationId: uuid('location_id').references(() => locations.id, {
      onDelete: 'set null',
    }),
    deletedAt: timestamp('deleted_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => [
    index('idx_users_email').on(t.email),
    index('idx_users_organization_id').on(t.organizationId),
    index('idx_users_location_id').on(t.locationId),
    check('users_role_check', sql`${t.role} IN ('user', 'manager', 'admin', 'sysadmin', 'platform_admin')`)
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
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
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
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
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
    currentPeriodEnd: timestamp('current_period_end'),
    cancelAtPeriodEnd: boolean('cancel_at_period_end').default(false).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
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
    lastUsedAt: timestamp('last_used_at'),
    expiresAt: timestamp('expires_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
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
    deletedAt: timestamp('deleted_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
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
    imageUrl: varchar('image_url', { length: 1024 }),
    sortOrder: integer('sort_order').default(0).notNull(),
    availabilitySchedule: jsonb('availability_schedule'), // e.g. [{ day: 1, startTime: '09:00', endTime: '17:00' }]
    deletedAt: timestamp('deleted_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => [
    index('idx_menu_items_category_id').on(t.categoryId),
    index('idx_menu_items_location_id').on(t.locationId),
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
    deletedAt: timestamp('deleted_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
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
  deletedAt: timestamp('deleted_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
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
    customerName: varchar('customer_name', { length: 255 }).notNull(),
    customerPhone: varchar('customer_phone', { length: 50 }).notNull(),
    status: varchar('status', { length: 50 }).default('pending').notNull(), // 'pending', 'preparing', 'ready', 'completed', 'cancelled'
    totalAmount: integer('total_amount').notNull(), // in cents
    // Fulfilment type (e.g. 'pickup', 'delivery', 'dine_in') and free-form kitchen notes captured
    // from the AI order webhook. Kept nullable/permissive so a novel value never drops an order.
    orderType: varchar('order_type', { length: 50 }),
    specialInstructions: varchar('special_instructions', { length: 1000 }),
    deletedAt: timestamp('deleted_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => [
    index('idx_orders_organization_id').on(t.organizationId),
    index('idx_orders_location_id').on(t.locationId),
    // M11: composite index for tenant-scoped paginated order lists
    index('idx_orders_org_created').on(t.organizationId, t.createdAt),
    check('orders_status_check', sql`${t.status} IN ('pending', 'confirmed', 'preparing', 'ready', 'delivered', 'cancelled')`)
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
    price: integer('price').notNull(), // price in cents at time of order
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [index('idx_order_items_order_id').on(t.orderId)],
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
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
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
    createdAt: timestamp('created_at').defaultNow().notNull(),
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
    deletedAt: timestamp('deleted_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
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
    deletedAt: timestamp('deleted_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
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
    deletedAt: timestamp('deleted_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
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
    lastHeartbeatAt: timestamp('last_heartbeat_at'),
    ipAddress: varchar('ip_address', { length: 45 }),
    model: varchar('model', { length: 100 }),
    notes: varchar('notes', { length: 500 }),
    deletedAt: timestamp('deleted_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
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
  expiresAt: timestamp('expires_at').notNull(),
  /** Set when consumed — prevents reuse */
  usedAt: timestamp('used_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Email verification tokens — single-use (Phase 7)
export const emailVerificationTokens = pgTable('email_verification_tokens', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  /** SHA-256 hash of the raw token sent in the email */
  tokenHash: varchar('token_hash', { length: 255 }).notNull().unique(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
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
    expiresAt: timestamp('expires_at'),
    deletedAt: timestamp('deleted_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
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
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
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
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [
    index('idx_usage_events_organization_id').on(t.organizationId),
    index('idx_usage_events_location_id').on(t.locationId),
    // M11: composite index for billing aggregation queries
    index('idx_usage_events_org_type_created').on(t.organizationId, t.eventType, t.createdAt),
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
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => [index('idx_org_webhooks_organization_id').on(t.organizationId)],
);

// Idempotency tracking for incoming webhooks
export const webhookEvents = pgTable('webhook_events', {
  eventId: varchar('event_id', { length: 255 }).primaryKey(),
  provider: varchar('provider', { length: 50 }).notNull(),
  status: varchar('status', { length: 50 }).default('pending').notNull(),
  receivedAt: timestamp('received_at').defaultNow().notNull(),
  processedAt: timestamp('processed_at'),
});
