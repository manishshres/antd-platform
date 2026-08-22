import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import { Public } from './common/decorators/public.decorator';
import { getAppVersion } from './common/version';

/**
 * `GET /` — the API's front door.
 *
 * Every route lives under the `api/v{n}` global prefix, so the bare domain used to answer
 * a bald 404 to anyone who pasted the API host into a browser. This serves a short
 * identity + contact payload instead. It is mounted outside the global prefix (see the
 * `exclude` in `main.ts`) and is version-neutral, so it stays at `/` as versions move.
 *
 * Contact details come from config so a deployment can correct them without a code change.
 */
@Public()
@Controller({ path: '/', version: VERSION_NEUTRAL })
export class RootController {
  constructor(private readonly configService: ConfigService) {}

  @Get()
  @ApiExcludeEndpoint()
  getRoot() {
    const website = this.configService.get<string>(
      'COMPANY_WEBSITE',
      'https://coneeko.com',
    );

    return {
      name: this.configService.get<string>('COMPANY_NAME', 'Coneeko'),
      description:
        'Coneeko is a restaurant platform: Voice AI phone ordering, POS, ' +
        'online and marketplace orders, kitchen printing, and reporting — ' +
        'in one system.',
      version: getAppVersion(),
      status: 'ok',
      documentation: `${website}/docs`,
      contact: {
        website,
        email: this.configService.get<string>(
          'CONTACT_EMAIL',
          'hello@coneeko.com',
        ),
        support: this.configService.get<string>(
          'SUPPORT_EMAIL',
          'support@coneeko.com',
        ),
      },
      endpoints: {
        health: '/api/v1/health',
        version: '/api/v1/health/version',
      },
      timestamp: new Date().toISOString(),
    };
  }
}
