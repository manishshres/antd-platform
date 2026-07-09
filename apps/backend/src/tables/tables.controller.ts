import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Patch,
  Delete,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { TablesService } from './tables.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../common/decorators/current-user.decorator';
import { CreateFloorPlanDto } from './dto/create-floor-plan.dto';
import { CreateTableDto } from './dto/create-table.dto';
import { UpdateFloorPlanDto } from './dto/update-floor-plan.dto';
import { UpdateTableDto } from './dto/update-table.dto';

@ApiTags('tables')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('tables')
export class TablesController {
  constructor(private readonly tablesService: TablesService) {}

  /** Floor plans are org resources — platform admins must select a tenant first. */
  private requireOrg(user: CurrentUserPayload): string {
    if (!user.organizationId) {
      throw new BadRequestException('Organization context required.');
    }
    return user.organizationId;
  }

  @Post('floor-plans')
  @ApiOperation({ summary: 'Create a new floor plan' })
  createFloorPlan(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: CreateFloorPlanDto,
  ) {
    return this.tablesService.createFloorPlan(this.requireOrg(user), dto);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new table' })
  createTable(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: CreateTableDto,
  ) {
    return this.tablesService.createTable(this.requireOrg(user), dto);
  }

  @Patch('floor-plans/:id')
  @ApiOperation({ summary: 'Update a floor plan' })
  updateFloorPlan(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: UpdateFloorPlanDto,
  ) {
    return this.tablesService.updateFloorPlan(this.requireOrg(user), id, dto);
  }

  @Delete('floor-plans/:id')
  @ApiOperation({ summary: 'Delete a floor plan' })
  deleteFloorPlan(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ) {
    return this.tablesService.deleteFloorPlan(this.requireOrg(user), id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a table' })
  updateTable(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: UpdateTableDto,
  ) {
    return this.tablesService.updateTable(this.requireOrg(user), id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a table' })
  deleteTable(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ) {
    return this.tablesService.deleteTable(this.requireOrg(user), id);
  }

  @Get('locations/:locationId/floor-plans')
  @ApiOperation({
    summary: 'Get all floor plans and tables for a location with status',
  })
  getFloorPlansWithTables(
    @CurrentUser() user: CurrentUserPayload,
    @Param('locationId') locationId: string,
  ) {
    return this.tablesService.getFloorPlansWithTables(
      this.requireOrg(user),
      locationId,
    );
  }
}
