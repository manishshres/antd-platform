import {
  Controller,
  Get,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
  Query,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { AnalyticsService } from './analytics.service';

@ApiTags('Analytics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('usage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get current period usage vs plan limits for the organization',
  })
  @ApiResponse({ status: 200, description: 'Returns usage statistics.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  async getUsage(@CurrentUser() user: CurrentUserPayload) {
    if (
      !user.organizationId &&
      user.role !== 'platform_admin' &&
      user.email !== 'admin@manish.dev'
    ) {
      throw new BadRequestException('Organization is required.');
    }
    return this.analyticsService.getCurrentPeriodUsage(
      user.organizationId || '',
    );
  }

  @Get('dashboard')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get dashboard KPIs and trends for a specific location',
  })
  @ApiResponse({ status: 200, description: 'Returns dashboard metrics.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  async getDashboard(
    @CurrentUser() user: CurrentUserPayload,
    @Query('locationId') locationId?: string,
  ) {
    if (
      !user.organizationId &&
      user.role !== 'platform_admin' &&
      user.email !== 'admin@manish.dev'
    ) {
      throw new BadRequestException('Organization is required.');
    }
    return this.analyticsService.getDashboardMetrics(
      user.organizationId || '',

      locationId,
    );
  }

  @Get('health')
  @Roles('sysadmin', 'platform_admin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get system health (Platform Admin only)',
  })
  @ApiResponse({ status: 200, description: 'Returns system health.' })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  async getHealth() {
    return this.analyticsService.getSystemHealth();
  }
}
