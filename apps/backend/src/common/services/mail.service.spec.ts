import { ConfigService } from '@nestjs/config';
import { MailService } from './mail.service';

const configWith = (values: Record<string, string>) =>
  ({
    get: (key: string, fallback?: string) => values[key] ?? fallback,
  }) as unknown as ConfigService;

describe('MailService — Resend HTTP transport', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  const send = (service: MailService) =>
    (
      service as unknown as {
        send: (o: {
          to: string;
          subject: string;
          text: string;
        }) => Promise<void>;
      }
    ).send({ to: 'someone@example.com', subject: 'Hi', text: 'Body' });

  it('posts to Resend instead of opening an SMTP socket', async () => {
    // Railway blocks outbound SMTP (25/465/587), so nodemailer times out no matter how
    // the credentials are set. Port 443 is open, so the HTTP API is the working path.
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(''),
    });
    global.fetch = fetchMock as jest.Mock & typeof fetch;

    const service = new MailService(
      configWith({
        RESEND_API_KEY: 're_test_key',
        SMTP_HOST: 'smtp.resend.com',
        SMTP_FROM: 'noreply@coneeko.com',
      }),
    );
    await send(service);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [
      string,
      { headers: Record<string, string>; body: string },
    ];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.headers.Authorization).toBe('Bearer re_test_key');
    expect(JSON.parse(init.body)).toMatchObject({
      from: 'noreply@coneeko.com',
      to: ['someone@example.com'],
      subject: 'Hi',
    });
  });

  it('logs the rejection detail rather than throwing', async () => {
    // An unverified sending domain is the most likely rejection, and Resend explains it
    // in the body — losing that detail is what made this hard to diagnose over SMTP.
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 403,
      text: () => Promise.resolve('{"message":"domain is not verified"}'),
    }) as jest.Mock & typeof fetch;

    const service = new MailService(configWith({ RESEND_API_KEY: 're_k' }));
    const errorSpy = jest
      .spyOn(
        (service as unknown as { logger: { error: (m: string) => void } })
          .logger,
        'error',
      )
      .mockImplementation(() => undefined);

    await expect(send(service)).resolves.toBeUndefined();
    expect(errorSpy.mock.calls[0][0]).toContain('domain is not verified');
  });

  it('forces SMTP when MAIL_TRANSPORT=smtp, even with a Resend key present', () => {
    // The escape hatch: a host that allows SMTP can keep using it without unsetting keys.
    const fetchMock = jest.fn();
    global.fetch = fetchMock as jest.Mock & typeof fetch;

    const service = new MailService(
      configWith({
        MAIL_TRANSPORT: 'smtp',
        RESEND_API_KEY: 're_test_key',
        SMTP_HOST: 'smtp.example.com',
      }),
    );

    expect(
      (service as unknown as { resendApiKey?: string }).resendApiKey,
    ).toBeUndefined();
    expect(
      (service as unknown as { transporter: unknown }).transporter,
    ).not.toBeNull();
  });

  it('uses the HTTP API when MAIL_TRANSPORT=http', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(''),
    });
    global.fetch = fetchMock as jest.Mock & typeof fetch;

    const service = new MailService(
      configWith({
        MAIL_TRANSPORT: 'http',
        RESEND_API_KEY: 're_test_key',
        SMTP_HOST: 'smtp.example.com',
      }),
    );
    await send(service);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to console logging when http is requested without a key', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as jest.Mock & typeof fetch;

    const service = new MailService(configWith({ MAIL_TRANSPORT: 'http' }));
    await send(service);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      (service as unknown as { transporter: unknown }).transporter,
    ).toBeNull();
  });

  it('falls back to SMTP when no Resend key is configured', () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as jest.Mock & typeof fetch;

    const service = new MailService(
      configWith({ SMTP_HOST: 'smtp.example.com' }),
    );

    expect(
      (service as unknown as { transporter: unknown }).transporter,
    ).not.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
