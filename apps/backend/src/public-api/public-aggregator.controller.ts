import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../common/decorators/public.decorator';
import { ApiKeyAuthGuard } from './guards/api-key-auth.guard';
import { AggregatorService } from '../aggregator/aggregator.service';
import { UpdateIntegrationAccountDto } from '../aggregator/dto/create-integration-account.dto';

/**
 * Read/toggle-only marketplace-integration surface for the POS (x-api-key auth). The
 * POS has no JWT capability (it only ever talks to the public API), but a cashier still
 * needs to flip a store's auto-accept setting from the register without reaching for the
 * dashboard. Connecting a new marketplace (which carries a client secret) stays JWT-only
 * on `/api/v1/aggregator/integration-accounts` — this surface never accepts credentials.
 */
@ApiTags('Public API - Aggregator')
@ApiSecurity('x-api-key')
@Public() // Authenticated by API key, not JWT.
@SkipThrottle()
@UseGuards(ApiKeyAuthGuard)
@Controller({ version: '2', path: 'aggregator/integration-accounts' })
export class PublicAggregatorController {
  constructor(private readonly aggregatorService: AggregatorService) {}

  @Get()
  @ApiOperation({
    summary:
      'List the org’s marketplace integration accounts (no credentials).',
  })
  @ApiResponse({ status: 200, description: 'Integration accounts.' })
  async listAccounts(
    @Req() request: import('express').Request & { organizationId: string },
  ) {
    return this.aggregatorService.listIntegrationAccounts(
      request.organizationId,
    );
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Flip a marketplace account’s auto-accept setting from the POS.',
  })
  @ApiResponse({ status: 200, description: 'Account updated.' })
  @ApiResponse({ status: 404, description: 'Account not found.' })
  async updateAccount(
    @Req() request: import('express').Request & { organizationId: string },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateIntegrationAccountDto,
  ) {
    return this.aggregatorService.updateIntegrationAccount(
      request.organizationId,
      id,
      dto,
    );
  }
}
