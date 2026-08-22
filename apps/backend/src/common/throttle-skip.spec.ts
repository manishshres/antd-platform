import { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { EnforceThrottle } from './decorators/enforce-throttle.decorator';
import { createThrottleSkipIf } from './throttle-skip';

class OpenController {
  handler() {}
}

@EnforceThrottle()
class GuardedController {
  handler() {}
}

type ControllerClass = (new () => unknown) & {
  prototype: { handler: () => void };
};

const contextFor = (target: ControllerClass) =>
  ({
    getHandler: () => target.prototype.handler,
    getClass: () => target,
  }) as unknown as ExecutionContext;

const configWith = (enabled?: string) =>
  ({
    get: (_key: string, fallback: string) => enabled ?? fallback,
  }) as unknown as ConfigService;

describe('createThrottleSkipIf', () => {
  const reflector = new Reflector();

  it('skips throttling on ordinary routes while the switch is off', () => {
    const skipIf = createThrottleSkipIf(configWith(), reflector);

    expect(skipIf(contextFor(OpenController))).toBe(true);
  });

  it('keeps throttling @EnforceThrottle() routes while the switch is off', () => {
    // Login and POS PIN entry must stay bounded even with rate limiting disabled.
    const skipIf = createThrottleSkipIf(configWith(), reflector);

    expect(skipIf(contextFor(GuardedController))).toBe(false);
  });

  it('throttles everything once THROTTLE_ENABLED=true', () => {
    const skipIf = createThrottleSkipIf(configWith('true'), reflector);

    expect(skipIf(contextFor(OpenController))).toBe(false);
    expect(skipIf(contextFor(GuardedController))).toBe(false);
  });
});
