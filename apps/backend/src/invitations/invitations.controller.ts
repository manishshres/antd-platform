import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
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
import { Public } from '../common/decorators/public.decorator';
import { InvitationsService } from './invitations.service';
import { CreateInvitationDto } from './dto/create-invitation.dto';
import { AcceptInvitationDto } from './dto/accept-invitation.dto';

@ApiTags('Invitations')
@Controller('invitations')
export class InvitationsController {
  constructor(private readonly invitationsService: InvitationsService) {}

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard, OrgStatusGuard)
  // Ensure we use the proper role decorator from common, assuming @Roles from common/decorators/roles.decorator
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Invite a user to the organization' })
  @ApiResponse({ status: 201, description: 'Invitation sent.' })
  async createInvitation(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: CreateInvitationDto,
  ) {
    if (!user.organizationId) {
      throw new BadRequestException('User does not belong to an organization.');
    }
    // Only sysadmin can invite (RolesGuard handles this if we add @Roles('sysadmin'), but doing it here explicitly too is fine or letting guard do it)
    if (user.role !== 'sysadmin' && user.role !== 'platform_admin') {
      throw new BadRequestException('Only sysadmin can invite users.');
    }
    return this.invitationsService.createInvitation(
      user.organizationId,
      user.id,
      dto,
    );
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard, OrgStatusGuard)
  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List invitations for the organization' })
  async listInvitations(@CurrentUser() user: CurrentUserPayload) {
    if (!user.organizationId) {
      throw new BadRequestException('User does not belong to an organization.');
    }
    return this.invitationsService.listInvitations(user.organizationId);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard, OrgStatusGuard)
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke a pending invitation' })
  async revokeInvitation(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ) {
    if (!user.organizationId) {
      throw new BadRequestException('User does not belong to an organization.');
    }
    if (user.role !== 'sysadmin' && user.role !== 'platform_admin') {
      throw new BadRequestException('Only sysadmin can revoke invitations.');
    }
    return this.invitationsService.revokeInvitation(user.organizationId, id);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard, OrgStatusGuard)
  @Post(':id/resend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resend a pending invitation' })
  async resendInvitation(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ) {
    if (!user.organizationId) {
      throw new BadRequestException('User does not belong to an organization.');
    }
    if (user.role !== 'sysadmin' && user.role !== 'platform_admin') {
      throw new BadRequestException('Only sysadmin can resend invitations.');
    }
    return this.invitationsService.resendInvitation(user.organizationId, id);
  }

  @Public()
  @Post('accept')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Accept an invitation and set password' })
  async acceptInvitation(@Body() dto: AcceptInvitationDto) {
    return this.invitationsService.acceptInvitation(dto);
  }

  @Public()
  @Get(':token/validate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Validate an invitation token' })
  async validateToken(@Param('token') token: string) {
    return this.invitationsService.validateToken(token);
  }
}
