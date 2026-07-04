import {
  Controller,
  Post,
  Get,
  Patch,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  Query,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PlatformAdminGuard } from '../auth/guards/platform-admin.guard';
import { ProvisioningService } from './provisioning.service';
import { InvitationsService } from '../invitations/invitations.service';
import { CreateOrgProvisionDto } from './dto/create-org-provision.dto';
import { AddLocationProvisioningDto } from './dto/add-location-provisioning.dto';
import { CreateInvitationDto } from '../invitations/dto/create-invitation.dto';
import { ProvisioningStatusResponseDto } from './dto/provisioning-status-response.dto';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../common/decorators/current-user.decorator';

@ApiTags('Provisioning (Platform Admin)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
@Controller('admin/organizations')
export class ProvisioningController {
  constructor(
    private readonly provisioningService: ProvisioningService,
    private readonly invitationsService: InvitationsService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Create org + first location, enqueue provisioning',
  })
  @ApiResponse({ status: 202, description: 'Provisioning started.' })
  async createOrganization(@Body() dto: CreateOrgProvisionDto) {
    return this.provisioningService.createOrganizationProvisioning(dto);
  }

  @Post(':id/locations')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary:
      'Create a new location for an existing organization, enqueue provisioning',
  })
  @ApiResponse({ status: 202, description: 'Location Provisioning started.' })
  async addLocation(
    @Param('id') id: string,
    @Body() dto: AddLocationProvisioningDto,
  ) {
    return this.provisioningService.addLocationProvisioning(id, dto);
  }

  @Get('ai-agents')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List all Voice AI Agents from Telnyx' })
  async listAiAgents() {
    return this.provisioningService.listTelnyxAssistants();
  }

  @Get('available-numbers')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Search available phone numbers from Telnyx' })
  async searchAvailableNumbers(
    @Query('country') country: string,
    @Query('state') state?: string,
    @Query('city') city?: string,
  ) {
    return this.provisioningService.searchAvailableNumbers(country, state, city);
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List all organizations with status' })
  @ApiResponse({ status: 200, description: 'List of organizations.' })
  async listOrganizations() {
    return this.provisioningService.listOrganizations();
  }

  @Get('provisioning-summary')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get aggregate provisioning summary' })
  async getProvisioningSummary() {
    return this.provisioningService.getProvisioningSummary();
  }

  @Get('provisioning-failures')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List failed provisioning steps' })
  async getProvisioningFailures() {
    return this.provisioningService.getProvisioningFailures();
  }

  @Get(':id/provisioning-status')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get step-by-step provisioning progress' })
  @ApiResponse({
    status: 200,
    description: 'Provisioning status.',
    type: ProvisioningStatusResponseDto,
  })
  async getProvisioningStatus(@Param('id') id: string) {
    return this.provisioningService.getProvisioningStatus(id);
  }

  @Post(':id/retry')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Retry all failed provisioning steps' })
  @ApiResponse({ status: 200, description: 'Provisioning retried.' })
  async retryProvisioning(@Param('id') id: string) {
    return this.provisioningService.retryProvisioning(id);
  }

  @Post(':id/retry-step/:stepId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Retry specific failed step' })
  @ApiResponse({ status: 200, description: 'Step retried.' })
  async retryStep(@Param('id') id: string, @Param('stepId') stepId: string) {
    return this.provisioningService.retryStep(id, stepId);
  }

  @Post(':id/skip-step/:stepId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Manually skip a specific step' })
  @ApiResponse({ status: 200, description: 'Step skipped.' })
  async skipStep(@Param('id') id: string, @Param('stepId') stepId: string) {
    return this.provisioningService.skipStep(id, stepId);
  }

  @Post(':id/deprovision')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Release Telnyx resources and archive org' })
  @ApiResponse({ status: 200, description: 'Deprovisioned successfully.' })
  async deprovision(@Param('id') id: string) {
    return this.provisioningService.deprovision(id);
  }

  @Post(':id/invite')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Invite a sysadmin to the organization' })
  async inviteSysadmin(
    @Param('id') id: string,
    @Body() dto: CreateInvitationDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.invitationsService.createInvitation(id, user.id, dto);
  }

  @Get(':id/invitations')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List invitations for an organization' })
  async listInvitations(@Param('id') id: string) {
    return this.invitationsService.listInvitations(id);
  }

  @Patch(':id/status')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update organization status (active/suspended)' })
  async updateStatus(@Param('id') id: string, @Body('status') status: string) {
    return this.provisioningService.setStatus(id, status);
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Update organization details (including featureFlags)',
  })
  async updateOrganization(
    @Param('id') id: string,
    @Body() dto: Record<string, unknown>,
  ) {
    return this.provisioningService.updateOrganization(id, dto);
  }
}
