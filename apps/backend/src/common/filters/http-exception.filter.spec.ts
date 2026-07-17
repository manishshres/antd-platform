import { GlobalExceptionFilter } from './http-exception.filter';
import { BadRequestException, HttpException, ArgumentsHost } from '@nestjs/common';

/**
 * Targets the body-redaction helper used when forwarding request bodies to
 * Sentry. PII redaction is internal (not exported) so we exercise it via the
 * 400-capture branch of the filter: a thrown BadRequestException routes
 * `request.body` through `redactSensitiveFields` before capture, which is
 * the only place it matters for production.
 */
describe('GlobalExceptionFilter redaction', () => {
  let captured: Record<string, unknown>[];
  let filter: GlobalExceptionFilter;

  const hostFor = (
    body: unknown,
    url = '/api/v2/test',
  ): ArgumentsHost =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({
          url,
          method: 'POST',
          headers: {},
          body,
        } as never),
        getResponse: () => ({ status: () => ({ json: () => undefined }) } as never),
        getNext: () => undefined,
      }),
      getArgs: () => [],
      getArgByIndex: () => undefined,
      switchToRpc: () => undefined as never,
      switchToWs: () => undefined as never,
      getType: () => 'http',
      getClass: () => undefined as never,
      getHandler: () => undefined as never,
    }) as unknown as ArgumentsHost;

  beforeEach(() => {
    captured = [];
    filter = new GlobalExceptionFilter();
    // Stub Sentry so the filter doesn't talk to the network.
    const sentry = require('@sentry/node');
    jest
      .spyOn(sentry, 'captureException')
      .mockImplementation((...args: unknown[]) => {
        const last = args[args.length - 1] as Record<string, unknown>;
        if (last && typeof last === 'object') captured.push(last);
        return 'stubbed-event-id';
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('masks password fields before forwarding to Sentry', () => {
    filter.catch(
      new BadRequestException('Bad input'),
      hostFor({ email: 'a@b.c', password: 'hunter2', nested: { refreshToken: 'r1' } }),
    );
    // Inspect the most recent capture's body
    const last = captured[0]?.extra as Record<string, unknown> | undefined;
    const body = last?.body as Record<string, unknown>;
    expect(body).toBeDefined();
    expect(body.email).toBe('a@b.c');
    expect(body.password).toBe('***');
    expect((body.nested as Record<string, unknown>).refreshToken).toBe('***');
  });

  it('masks x-api-key fields and authorization headers', () => {
    filter.catch(
      new BadRequestException('bad'),
      hostFor({ 'x-api-key': 'coai_live_abc', authorization: 'Bearer eyJ' }),
    );
    const last = captured[0]?.extra as Record<string, unknown>;
    const body = last.body as Record<string, unknown>;
    expect(body['x-api-key']).toBe('***');
    expect(body.authorization).toBe('***');
  });

  it('preserves non-credential fields verbatim', () => {
    filter.catch(
      new BadRequestException('bad'),
      hostFor({ name: 'Tina', customerId: 'cust-123', nested: { phone: '+15551234567' } }),
    );
    const last = captured[0]?.extra as Record<string, unknown>;
    const body = last.body as Record<string, unknown>;
    expect(body.name).toBe('Tina');
    expect(body.customerId).toBe('cust-123');
    expect((body.nested as Record<string, unknown>).phone).toBe('+15551234567');
  });

  it('does not crash on array-shaped body', () => {
    expect(() =>
      filter.catch(new BadRequestException('bad'), hostFor([{ password: 'p1' }])),
    ).not.toThrow();
    const last = captured[0]?.extra as Record<string, unknown>;
    const body = last.body as Array<Record<string, unknown>>;
    expect(body[0].password).toBe('***');
  });

  it('does not crash on non-object body (null, string)', () => {
    expect(() =>
      filter.catch(new BadRequestException('bad'), hostFor(null as unknown)),
    ).not.toThrow();
    expect(() =>
      filter.catch(new BadRequestException('bad'), hostFor('plain string' as unknown)),
    ).not.toThrow();
  });
});
