import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
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
import { Roles } from '../common/decorators/roles.decorator';
import { PlatformAdminGuard } from '../auth/guards/platform-admin.guard';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../common/decorators/current-user.decorator';
import { OrganizationsService } from './organizations.service';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import { UpdateFeatureFlagsDto } from './dto/update-feature-flags.dto';
import { PaginationDto } from '../common/dto/pagination.dto';
import { PaginatedResponseDto } from '../common/dto/paginated-response.dto';

@ApiTags('Organizations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get current user organization details' })
  @ApiResponse({ status: 200, description: 'Returns organization details.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  async getMyOrganization(@CurrentUser() user: CurrentUserPayload) {
    if (!user.organizationId) {
      throw new BadRequestException('You do not belong to any organization.');
    }
    return this.organizationsService.getMyOrganization(user.organizationId);
  }

  @Patch()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update current user organization details' })
  @ApiResponse({
    status: 200,
    description: 'Organization updated successfully.',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  async updateMyOrganization(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: UpdateOrganizationDto,
  ) {
    if (!user.organizationId) {
      throw new BadRequestException('You do not belong to any organization.');
    }
    return this.organizationsService.updateMyOrganization(
      user.organizationId,
      dto,
    );
  }

  @Patch('feature-flags')
  @Roles('sysadmin', 'platform_admin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update organization feature flags' })
  @ApiResponse({
    status: 200,
    description: 'Feature flags updated successfully.',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  async updateMyFeatureFlags(
    @Body() dto: UpdateFeatureFlagsDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    if (!user.organizationId) {
      throw new BadRequestException('You do not belong to any organization.');
    }
    return this.organizationsService.updateFeatureFlags(
      user.organizationId,
      dto,
    );
  }

  // ─── Global Platform Admin Endpoints ─────────────────────────────────────

  @Get('global')
  @UseGuards(PlatformAdminGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'List all organizations in the platform (Platform Admin only)',
  })
  @ApiResponse({ status: 200, description: 'Returns all organizations.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  async listAllOrganizationsGlobal(
    @Query() pagination: PaginationDto,
  ): Promise<PaginatedResponseDto<unknown>> {
    return this.organizationsService.listAllOrganizationsGlobal(pagination);
  }

  @Get('global/:id')
  @UseGuards(PlatformAdminGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get any organization globally by ID (Platform Admin only)',
  })
  @ApiResponse({ status: 200, description: 'Returns the organization.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  @ApiResponse({ status: 404, description: 'Not Found.' })
  async getOrganizationGlobal(@Param('id') id: string) {
    return this.organizationsService.getMyOrganization(id);
  }

  @Post('global')
  @UseGuards(PlatformAdminGuard)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a new organization globally (Platform Admin only)',
  })
  @ApiResponse({
    status: 201,
    description: 'Organization created successfully.',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  async createOrganizationGlobal(@Body() dto: CreateOrganizationDto) {
    return this.organizationsService.createOrganizationGlobal(dto);
  }

  @Patch('global/:id')
  @UseGuards(PlatformAdminGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Update any organization globally by ID (Platform Admin only)',
  })
  @ApiResponse({
    status: 200,
    description: 'Organization updated successfully.',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  async updateOrganizationGlobal(
    @Param('id') id: string,
    @Body() dto: UpdateOrganizationDto,
  ) {
    return this.organizationsService.updateOrganizationGlobal(id, dto);
  }

  @Delete('global/:id')
  @UseGuards(PlatformAdminGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Soft-delete any organization globally by ID (Platform Admin only)',
  })
  @ApiResponse({
    status: 200,
    description: 'Organization deleted successfully.',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  async deleteOrganizationGlobal(@Param('id') id: string) {
    return this.organizationsService.deleteOrganizationGlobal(id);
  }

  @Patch('global/:id/feature-flags')
  @UseGuards(PlatformAdminGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Update feature flags of any organization globally (Platform Admin only)',
  })
  @ApiResponse({
    status: 200,
    description: 'Feature flags updated successfully.',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  async updateOrganizationFeatureFlagsGlobal(
    @Param('id') id: string,
    @Body() dto: UpdateFeatureFlagsDto,
  ) {
    return this.organizationsService.updateFeatureFlags(id, dto);
  }
}
