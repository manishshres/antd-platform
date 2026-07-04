import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { ExecutionContext, HttpException } from '@nestjs/common';
import { PlanLimitGuard } from './plan-limit.guard';
import { DRIZZLE } from '../../database/database.module';
import { BillingService } from '../billing.service';

/**
 * Builds a chainable drizzle `select().from().where()` mock whose awaited result is
 * `rows`. The guard calls `.limit(1)` on plan/subscription queries and awaits `.where()`
 * directly on count queries, so both `limit` and `where` resolve to `rows`.
 */
function selectReturning(rows: unknown[]) {
  // Thenable chain: `.from().where()` can be awaited directly (count queries) OR followed by
  // `.limit(1)` (subscription/plan queries) — both resolve to `rows`.
  const chain: Record<string, unknown> = {
    from: jest.fn(() => chain),
    where: jest.fn(() => chain),
    limit: jest.fn(() => Promise.resolve(rows)),
    then: (resolve: (v: unknown[]) => unknown) => resolve(rows),
  };
  return chain;
}

function contextWithUser(): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user: { id: 'user-1', organizationId: 'org-1' } }),
    }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

describe('PlanLimitGuard', () => {
  let guard: PlanLimitGuard;
  let reflector: Reflector;
  let dbSelect: jest.Mock;

  beforeEach(async () => {
    dbSelect = jest.fn();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlanLimitGuard,
        { provide: DRIZZLE, useValue: { select: dbSelect } },
        {
          provide: BillingService,
          useValue: { getRequiredOrg: jest.fn().mockResolvedValue('org-1') },
        },
      ],
    }).compile();

    guard = module.get(PlanLimitGuard);
    reflector = module.get(Reflector);
  });

  it('allows the request when no @CheckLimit metadata is present', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    await expect(guard.canActivate(contextWithUser())).resolves.toBe(true);
  });

  it('allows when current usage is below the plan limit', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue('voiceAgents');
    // 1: subscription (free), 2: plan row, 3: count query → 0 agents
    dbSelect
      .mockReturnValueOnce(
        selectReturning([{ status: 'active', planId: 'free' }]),
      )
      .mockReturnValueOnce(selectReturning([{ voiceAgentsLimit: 1 }]))
      .mockReturnValueOnce(selectReturning([{ value: 0 }]));

    await expect(guard.canActivate(contextWithUser())).resolves.toBe(true);
  });

  it('rejects with 402 when current usage has reached the plan limit', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue('voiceAgents');
    dbSelect
      .mockReturnValueOnce(
        selectReturning([{ status: 'active', planId: 'free' }]),
      )
      .mockReturnValueOnce(selectReturning([{ voiceAgentsLimit: 1 }]))
      .mockReturnValueOnce(selectReturning([{ value: 1 }])); // already at limit

    await expect(guard.canActivate(contextWithUser())).rejects.toBeInstanceOf(
      HttpException,
    );
  });
});
