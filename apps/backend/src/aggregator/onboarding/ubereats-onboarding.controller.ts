import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Redirect,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import {
  ApiBearerAuth,
  ApiExcludeEndpoint,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Public } from '../../common/decorators/public.decorator';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../../common/decorators/current-user.decorator';
import { UberEatsOnboardingService } from './ubereats-onboarding.service';
import {
  ActivateUberStoresDto,
  StartUberOnboardingDto,
} from '../dto/ubereats-integration.dto';

/**
 * Self-serve Uber Eats connection for a merchant. Every route is JWT + org scoped except
 * the OAuth callback, which Uber sends the merchant's *browser* to — that one is
 * authenticated by the single-use `state` it carries and answers with a redirect back into
 * the dashboard, not JSON.
 */
@ApiTags('Aggregator')
@Controller('aggregator/ubereats/onboarding')
export class UberEatsOnboardingController {
  constructor(private readonly onboarding: UberEatsOnboardingService) {}

  private orgId(user: CurrentUserPayload): string {
    if (!user.organizationId) {
      throw new BadRequestException('No organization in context.');
    }
    return user.organizationId;
  }

  @Post('start')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('owner', 'admin', 'manager')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Begin the Uber Eats merchant authorization',
    description:
      'Returns the Uber consent URL to send the merchant to. Uber only accepts a ' +
      'redirect_uri registered on the app dashboard, and the state is single-use and ' +
      'expires in 15 minutes.',
  })
  @ApiResponse({ status: 201, description: 'Authorization URL issued.' })
  async start(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: StartUberOnboardingDto,
  ) {
    return this.onboarding.start(
      this.orgId(user),
      user.id ?? null,
      dto?.locationId,
    );
  }

  /**
   * Uber's redirect target. Register this exact URL on the Uber app dashboard:
   *   {PUBLIC_API_URL}/api/v1/aggregator/ubereats/onboarding/callback
   */
  @Get('callback')
  @Public() // A browser redirect from Uber — authenticated by the single-use state.
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Redirect()
  @ApiExcludeEndpoint()
  async callback(
    @Query('code') code?: string,
    @Query('state') state?: string,
    @Query('error') error?: string,
  ) {
    const url = await this.onboarding.handleCallback({ code, state, error });
    return { url, statusCode: HttpStatus.FOUND };
  }

  @Get(':sessionId/stores')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('owner', 'admin', 'manager')
  @ApiOperation({
    summary: 'List the stores the merchant’s authorization exposed',
  })
  async stores(
    @CurrentUser() user: CurrentUserPayload,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
  ) {
    return this.onboarding.listStores(this.orgId(user), sessionId);
  }

  @Post(':sessionId/activate')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('owner', 'admin', 'manager')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Provision the selected stores and enable order webhooks',
    description:
      'Creates an integration account per store, associates the app with the store using ' +
      'the merchant token, then enables order webhooks with the developer token. Reports ' +
      'per-store success so a partial failure is visible.',
  })
  async activate(
    @CurrentUser() user: CurrentUserPayload,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Body() dto: ActivateUberStoresDto,
  ) {
    return this.onboarding.activate(this.orgId(user), sessionId, dto);
  }
}
