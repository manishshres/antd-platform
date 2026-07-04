import { Controller, Get, UseGuards, Query, Req } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
} from '@nestjs/swagger';
import { ApiKeyAuthGuard } from './guards/api-key-auth.guard';
import { MenusService } from '../menus/menus.service';
import { PaginationDto } from '../common/dto/pagination.dto';
import { ThrottlerGuard, Throttle } from '@nestjs/throttler';

@ApiTags('Public API - Menus')
@ApiSecurity('x-api-key')
@UseGuards(ApiKeyAuthGuard, ThrottlerGuard)
@Throttle({ default: { limit: 60, ttl: 60000 } })
@Controller({ version: '2', path: 'menus' })
export class PublicMenusController {
  constructor(private readonly menusService: MenusService) {}

  @Get()
  @ApiOperation({ summary: 'Get the menu for the organization' })
  @ApiResponse({
    status: 200,
    description: 'Returns category-grouped menu list.',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized. Invalid API key.' })
  async getMenu(
    @Req() request: import('express').Request & { organizationId: string },
    @Query() pagination: PaginationDto,
    @Query('locationId') locationId?: string,
  ) {
    const orgId = request.organizationId;
    return this.menusService.getMenuByOrg(orgId, pagination, locationId);
  }
}
