import {
  Controller,
  Post,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
  Body,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PlatformAdminGuard } from '../auth/guards/platform-admin.guard';
import { InvitationsService } from './invitations.service';
import { CreateInvitationDto } from './dto/create-invitation.dto';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../common/decorators/current-user.decorator';

@ApiTags('Invitations (Platform Admin)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
@Controller('admin/invitations')
export class AdminInvitationsController {
  constructor(private readonly invitationsService: InvitationsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create an invitation for an organization (Platform Admin)',
  })
  @ApiResponse({ status: 201, description: 'Invitation sent.' })
  async createInvitation(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: CreateInvitationDto & { organizationId: string },
  ) {
    return this.invitationsService.createInvitation(
      dto.organizationId,
      user.id,
      dto,
    );
  }

  @Post(':id/revoke')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke an invitation (Platform Admin)' })
  @ApiResponse({ status: 200, description: 'Invitation revoked.' })
  async revokeInvitation(
    @Param('id') id: string,
    @Body('organizationId') organizationId: string,
  ) {
    return this.invitationsService.revokeInvitation(organizationId, id);
  }

  @Post(':id/resend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resend an invitation (Platform Admin)' })
  @ApiResponse({ status: 200, description: 'Invitation resent.' })
  async resendInvitation(
    @Param('id') id: string,
    @Body('organizationId') organizationId: string,
  ) {
    return this.invitationsService.resendInvitation(organizationId, id);
  }
}
