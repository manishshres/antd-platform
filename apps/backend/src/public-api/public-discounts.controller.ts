import { Controller, Get, UseGuards, Req } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
} from '@nestjs/swagger';
import { ApiKeyAuthGuard } from './guards/api-key-auth.guard';
import { DiscountsService } from '../discounts/discounts.service';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../common/decorators/public.decorator';
import { apiPrincipal } from './api-principal';

@ApiTags('Public API - Discounts')
@ApiSecurity('x-api-key')
@Public() // Authenticated by API key, not JWT.
@SkipThrottle()
@UseGuards(ApiKeyAuthGuard)
@Controller({ version: '2', path: 'discounts' })
export class PublicDiscountsController {
  constructor(private readonly discountsService: DiscountsService) {}

  @Get()
  @ApiOperation({
    summary: 'Active discounts/promo codes — POS clients cache these offline',
  })
  @ApiResponse({ status: 200, description: 'Returns active discounts.' })
  @ApiResponse({ status: 401, description: 'Unauthorized. Invalid API key.' })
  async listActive(
    @Req() request: import('express').Request & { organizationId: string },
  ) {
    return this.discountsService.listActive(
      apiPrincipal(request.organizationId),
    );
  }
}
