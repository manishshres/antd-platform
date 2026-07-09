import {
  Controller,
  Post,
  Patch,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
  Get,
  Query,
  Delete,
  Logger,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { OrgStatusGuard } from '../auth/guards/org-status.guard';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../common/decorators/current-user.decorator';
import { LocationsService } from './locations.service';
import { UpdateAiConfigDto } from './dto/update-ai-config.dto';
import { AssignManagerDto } from './dto/assign-manager.dto';
import { CreateLocationDto } from './dto/create-location.dto';
import { UpdateLocationDto } from './dto/update-location.dto';

@ApiTags('Locations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, OrgStatusGuard)
@Controller('locations')
export class LocationsController {
  private readonly logger = new Logger(LocationsController.name);

  constructor(private readonly locationsService: LocationsService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List all locations in the organization' })
  @ApiResponse({ status: 200, description: 'Returns a list of locations.' })
  async listLocations(
    @CurrentUser() user: CurrentUserPayload,
    @Query('orgId') orgId?: string,
  ) {
    let targetOrgId = user.organizationId;

    // Platform admins can override the organization ID via query parameter
    if (
      orgId &&
      orgId !== 'undefined' &&
      orgId !== 'null' &&
      (user.role === 'platform_admin' || user.isPlatformAdmin)
    ) {
      targetOrgId = orgId;
    }

    if (!targetOrgId) {
      // An authenticated user with no organization simply has no locations yet.
      // Return an empty list (a clean empty state on the client) rather than a
      // 400 that the frontend would surface as a hard error.
      this.logger.warn(
        `User ${user.id} has no organization and provided no orgId; returning empty locations list.`,
      );
      return [];
    }

    return this.locationsService.listLocations(targetOrgId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new location (Draft)' })
  @ApiResponse({ status: 201, description: 'Location created.' })
  async createLocation(
    @Body() dto: CreateLocationDto,
    @CurrentUser() user: CurrentUserPayload,
    @Query('orgId') orgId?: string,
  ) {
    let targetOrgId = user.organizationId;
    if (
      orgId &&
      orgId !== 'undefined' &&
      orgId !== 'null' &&
      (user.role === 'platform_admin' || user.isPlatformAdmin)
    ) {
      targetOrgId = orgId;
    }
    if (!targetOrgId) {
      throw new BadRequestException(
        'User does not belong to an organization and no orgId provided.',
      );
    }
    if (
      user.role !== 'sysadmin' &&
      user.role !== 'platform_admin' &&
      !user.isPlatformAdmin
    ) {
      throw new BadRequestException(
        'Only sysadmin or platform_admin can create locations.',
      );
    }
    return this.locationsService.createLocation(targetOrgId, dto);
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update location basic details' })
  @ApiResponse({ status: 200, description: 'Location updated.' })
  async updateLocation(
    @Param('id') id: string,
    @Body() dto: UpdateLocationDto,
    @CurrentUser() user: CurrentUserPayload,
    @Query('orgId') orgId?: string,
  ) {
    let targetOrgId = user.organizationId;
    if (
      orgId &&
      orgId !== 'undefined' &&
      orgId !== 'null' &&
      (user.role === 'platform_admin' || user.isPlatformAdmin)
    ) {
      targetOrgId = orgId;
    }
    if (!targetOrgId) {
      throw new BadRequestException(
        'User does not belong to an organization and no orgId provided.',
      );
    }
    if (
      user.role !== 'sysadmin' &&
      user.role !== 'platform_admin' &&
      user.role !== 'manager' &&
      !user.isPlatformAdmin
    ) {
      throw new BadRequestException(
        'Only sysadmin, platform_admin, or manager can update location details.',
      );
    }
    return this.locationsService.updateLocation(targetOrgId, id, dto);
  }

  @Patch(':id/ai-config')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update location AI configuration' })
  @ApiResponse({ status: 200, description: 'AI Config updated.' })
  async updateAiConfig(
    @Param('id') id: string,
    @Body() dto: UpdateAiConfigDto,
    @CurrentUser() user: CurrentUserPayload,
    @Query('orgId') orgId?: string,
  ) {
    let targetOrgId = user.organizationId;
    if (
      orgId &&
      orgId !== 'undefined' &&
      orgId !== 'null' &&
      (user.role === 'platform_admin' || user.isPlatformAdmin)
    ) {
      targetOrgId = orgId;
    }
    if (!targetOrgId) {
      throw new BadRequestException(
        'User does not belong to an organization and no orgId provided.',
      );
    }
    // Only sysadmin or manager can update AI config
    if (
      user.role !== 'sysadmin' &&
      user.role !== 'manager' &&
      user.role !== 'platform_admin' &&
      !user.isPlatformAdmin
    ) {
      throw new BadRequestException(
        'Only sysadmin or manager can update AI config.',
      );
    }
    return this.locationsService.updateAiConfig(targetOrgId, id, dto);
  }

  @Post(':id/assign-manager')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Assign or invite a user as a location manager' })
  @ApiResponse({ status: 200, description: 'Manager assigned or invited.' })
  async assignManager(
    @Param('id') id: string,
    @Body() dto: AssignManagerDto,
    @CurrentUser() user: CurrentUserPayload,
    @Query('orgId') orgId?: string,
  ) {
    let targetOrgId = user.organizationId;
    if (
      orgId &&
      orgId !== 'undefined' &&
      orgId !== 'null' &&
      (user.role === 'platform_admin' || user.isPlatformAdmin)
    ) {
      targetOrgId = orgId;
    }
    if (!targetOrgId) {
      throw new BadRequestException(
        'User does not belong to an organization and no orgId provided.',
      );
    }
    // Only sysadmin or platform_admin can assign a manager
    if (
      user.role !== 'sysadmin' &&
      user.role !== 'platform_admin' &&
      !user.isPlatformAdmin
    ) {
      throw new BadRequestException(
        'Only sysadmin or platform_admin can assign managers.',
      );
    }
    return this.locationsService.assignManager(targetOrgId, id, user.id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a location' })
  @ApiResponse({ status: 200, description: 'Location deleted.' })
  async deleteLocation(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @Query('orgId') orgId?: string,
  ) {
    let targetOrgId = user.organizationId;
    if (
      orgId &&
      orgId !== 'undefined' &&
      orgId !== 'null' &&
      (user.role === 'platform_admin' || user.isPlatformAdmin)
    ) {
      targetOrgId = orgId;
    }
    if (!targetOrgId) {
      throw new BadRequestException(
        'User does not belong to an organization and no orgId provided.',
      );
    }
    // Only sysadmin or platform_admin can delete a location
    if (
      user.role !== 'sysadmin' &&
      user.role !== 'platform_admin' &&
      !user.isPlatformAdmin
    ) {
      throw new BadRequestException(
        'Only sysadmin or platform_admin can delete locations.',
      );
    }
    return this.locationsService.deleteLocation(targetOrgId, id);
  }
}
