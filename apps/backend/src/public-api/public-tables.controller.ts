import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
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
import { CreateFloorPlanDto } from '../tables/dto/create-floor-plan.dto';
import { CreateTableDto } from '../tables/dto/create-table.dto';
import { UpdateFloorPlanDto } from '../tables/dto/update-floor-plan.dto';
import { UpdateTableDto } from '../tables/dto/update-table.dto';

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

  @Post('floor-plans')
  @ApiOperation({ summary: 'Create a new floor plan' })
  createFloorPlan(
    @Req() request: import('express').Request & { organizationId: string },
    @Body() dto: CreateFloorPlanDto,
  ) {
    return this.tablesService.createFloorPlan(request.organizationId, dto);
  }

  @Patch('floor-plans/:id')
  @ApiOperation({ summary: 'Update a floor plan' })
  updateFloorPlan(
    @Req() request: import('express').Request & { organizationId: string },
    @Param('id') id: string,
    @Body() dto: UpdateFloorPlanDto,
  ) {
    return this.tablesService.updateFloorPlan(request.organizationId, id, dto);
  }

  @Delete('floor-plans/:id')
  @ApiOperation({ summary: 'Delete a floor plan' })
  deleteFloorPlan(
    @Req() request: import('express').Request & { organizationId: string },
    @Param('id') id: string,
  ) {
    return this.tablesService.deleteFloorPlan(request.organizationId, id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new table' })
  createTable(
    @Req() request: import('express').Request & { organizationId: string },
    @Body() dto: CreateTableDto,
  ) {
    return this.tablesService.createTable(request.organizationId, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a table' })
  updateTable(
    @Req() request: import('express').Request & { organizationId: string },
    @Param('id') id: string,
    @Body() dto: UpdateTableDto,
  ) {
    return this.tablesService.updateTable(request.organizationId, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a table' })
  deleteTable(
    @Req() request: import('express').Request & { organizationId: string },
    @Param('id') id: string,
  ) {
    return this.tablesService.deleteTable(request.organizationId, id);
  }
}
