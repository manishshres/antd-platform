# AGENTS.md — antd-backend (NestJS SaaS API)

Quick-reference rules for AI coding assistants working on this project. For detailed guidance, read `CLAUDE.md`.

---

## Tech Stack

- **Framework**: NestJS 11+ with TypeScript (strict mode)
- **Database**: PostgreSQL via **Drizzle ORM** — no raw SQL
- **Auth**: JWT access tokens (15 min) + HTTP-only refresh tokens (7 days, stored hashed in DB)
- **Queues**: BullMQ + Redis (print-queue, import-menu, webhook-queue)
- **MQTT**: Eclipse Mosquitto broker + MQTT.js client
- **Printer routing**: fixed topics `restaurant/{orgId}/kitchen/print` and `restaurant/{orgId}/receipt/print`
- **Billing**: Stripe SDK
- **Docs**: Swagger / OpenAPI at `http://localhost:4000/api/docs`

---

## Critical Rules

### 1. TypeScript — Strict, No `any`

```typescript
// ❌ Forbidden
const data: any = request.body;

// ✅ Correct
const data = request.body as unknown as CreateOrderDto;
```

Always run `npm run lint` and `npm run build` before finishing. Zero errors or warnings tolerated.

### 2. Database — Drizzle Only, Scoped to Org

```typescript
// ✅ Always scope queries by organizationId from the JWT (not from the request body)
const orgId = currentUser.organizationId;
await db.query.orders.findMany({
  where: and(eq(orders.organizationId, orgId), isNull(orders.deletedAt)),
});

// ❌ Never trust client-provided orgId
// ❌ Never use raw SQL strings
```

All schema changes go in `src/database/schema.ts`, then run:

```bash
npx drizzle-kit generate
npx drizzle-kit push
```

### 3. Authentication & Authorization

Use the parameter decorator `@CurrentUser()` to retrieve user context:

```typescript
// Protect routes with JwtAuthGuard and RolesGuard:
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'manager')
async getSensitiveInfo(@CurrentUser() user: CurrentUserPayload) {
  const orgId = user.organizationId;
  ...
}

// Public endpoints explicitly skip JwtAuthGuard via @Public():
@Public()
@Post('login')
```

- Enforce role AND org-scope checks in the **service layer** too, not just guards.
- Roles mapping hierarchy: `Owner` > `Admin` > `Manager` > `Agent` > `Viewer`.
- Never allow `'admin'` or `'owner'` role to be set during public registration.

### 4. Validation — All DTOs Must Use class-validator

```typescript
export class CreateMenuItemDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;

  @IsInt()
  @Min(0)
  price: number; // in cents
}
```

`ValidationPipe` is globally configured with `whitelist: true, forbidNonWhitelisted: true`.

### 5. API Documentation — All Endpoints Must Be Documented

```typescript
@ApiTags('menus')
@ApiOperation({ summary: 'Create a new menu category' })
@ApiResponse({ status: 201, type: CategoryResponseDto })
@ApiBearerAuth()
```

### 6. Error Handling — Never Expose Stack Traces

Use `throw new HttpException(...)` or NestJS built-ins. The `GlobalExceptionFilter` normalizes all errors. Never catch-and-swallow silently.

```typescript
throw new NotFoundException(`Order ${id} not found`);
throw new ForbiddenException('You do not have access to this resource');
throw new ConflictException('Email already in use');
```

### 7. Background Jobs — Never Block HTTP

Heavy operations (website parsing, printing, Stripe syncing, webhook processing) must be offloaded to BullMQ queues.

```typescript
// Heavy work → enqueue, don't process inline
await this.importQueue.add(
  'import-menu',
  { url, orgId },
  {
    attempts: 2,
    backoff: { type: 'exponential', delay: 3000 },
  },
);
return { message: 'Import queued', jobId: job.id };
```

### 8. Security — Required on All Features

- Rate limiting: `@Throttle({ default: { limit: 5, ttl: 60000 } })` on auth endpoints.
- Helmet: `app.use(helmet())` is registered in `main.ts`.
- Secrets: always via `this.configService.get<string>('KEY')` — never `process.env.KEY`.
- File uploads: validate MIME type AND magic bytes, not just extension.
- Audit log: call `this.auditService.log(...)` for all state-changing admin/user actions.

```typescript
await this.auditService.log({
  organizationId: user.organizationId,
  userId: user.id,
  action: 'menu.create',
  entityType: 'menu_item',
  entityId: newItem.id,
  newValue: newItem,
});
```

### 9. Module Structure — Consistent Layout

Each feature module must have:

```
feature/
  feature.module.ts
  feature.controller.ts   # HTTP only, no business logic
  feature.service.ts      # all business logic
  dto/
    create-feature.dto.ts
    update-feature.dto.ts
    feature-response.dto.ts
```

### 10. Logging — Use NestJS Logger

```typescript
private readonly logger = new Logger(OrdersService.name);

this.logger.log(`Order ${id} status changed to ${status}`);
this.logger.error(`Failed to publish print job: ${err.message}`, err.stack);
```

Never use `console.log()` or other plain console prints.

---

## Naming Conventions

| Type       | Convention    | Example              |
| ---------- | ------------- | -------------------- |
| Files      | `kebab-case`  | `orders.service.ts`  |
| Classes    | `PascalCase`  | `OrdersService`      |
| Methods    | `camelCase`   | `createOrder()`      |
| DB columns | `snake_case`  | `organization_id`    |
| Env vars   | `UPPER_SNAKE` | `JWT_SECRET`         |
| Routes     | `kebab-case`  | `/api/v1/menu-items` |

---

## Common Pitfalls & Anti-Patterns to Avoid

1. **JS-Side Array Filtering**: Do not pull all rows from the DB and filter in JS memory. Use optimized SQL queries with Drizzle operators like `inArray` or `eq`.
2. **Missing `emitDecoratorMetadata` Class Types**: Parameters typed with Interfaces like `CurrentUserPayload` inside controllers throw type emission errors under `emitDecoratorMetadata`. Declare them as a `class` instead.
3. **Synchronous Webhook Handling**: Never perform intensive validation or processing inside the webhook handler thread. Perform signature verification and quickly enqueue the work payload to BullMQ.
4. **Plaintext Refresh Tokens**: Never store unhashed refresh tokens in the database. Always use a SHA-256 hash representation.
5. **Telnyx Branding Leaks**: All carrier-specific terminologies and structures must be mapped to neutral, white-labeled internal DTOs before escaping the controller.

---

## Before Finishing Any Task

```bash
npm run lint     # must pass with 0 warnings
npm run build    # must compile cleanly
npm run test     # all unit tests must pass
```
