import {
  BadRequestException,
  Controller,
  Get,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
} from '@nestjs/swagger';
import { ApiKeyAuthGuard } from './guards/api-key-auth.guard';
import { TablesService } from '../tables/tables.service';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../common/decorators/public.decorator';

@ApiTags('Public API - Tables')
@ApiSecurity('x-api-key')
@Public() // Authenticated by API key, not JWT.
@SkipThrottle()
@UseGuards(ApiKeyAuthGuard)
@Controller({ version: '2', path: 'tables' })
export class PublicTablesController {
  constructor(private readonly tablesService: TablesService) {}

  @Get()
  @ApiOperation({
    summary: 'Floor plans with tables and live occupancy for a location',
  })
  @ApiResponse({ status: 200, description: 'Returns floor plans with tables.' })
  @ApiResponse({ status: 401, description: 'Unauthorized. Invalid API key.' })
  async getFloorPlans(
    @Req() request: import('express').Request & { organizationId: string },
    @Query('locationId') locationId?: string,
  ) {
    if (!locationId) {
      throw new BadRequestException('locationId query parameter is required.');
    }
    return this.tablesService.getFloorPlansWithTables(
      request.organizationId,
      locationId,
    );
  }
}
