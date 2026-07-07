import {
  Controller,
  Get,
  Post,
  Body,
  Param,
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
