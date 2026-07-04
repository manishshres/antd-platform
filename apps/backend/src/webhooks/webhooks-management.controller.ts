import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
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
import { Roles } from '../common/decorators/roles.decorator';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../common/decorators/current-user.decorator';
import { WebhooksManagementService } from './webhooks-management.service';
import { CreateOrgWebhookDto } from './dto/create-org-webhook.dto';

@ApiTags('Webhooks Management')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('webhooks/endpoints')
export class WebhooksManagementController {
  constructor(
    private readonly webhooksManagementService: WebhooksManagementService,
  ) {}

  @Get()
  @Roles('sysadmin', 'manager')
  @ApiOperation({ summary: 'List organization webhooks' })
  @ApiResponse({ status: 200, description: 'Returns list of webhooks.' })
  async listEndpoints(@CurrentUser() user: CurrentUserPayload) {
    if (!user.organizationId) {
      throw new BadRequestException('User does not belong to an organization.');
    }
    return this.webhooksManagementService.listEndpoints(user.organizationId);
  }

  @Post()
  @Roles('sysadmin', 'manager')
  @ApiOperation({ summary: 'Create a new webhook endpoint' })
  @ApiResponse({ status: 201, description: 'Webhook created.' })
  async createEndpoint(
    @Body() dto: CreateOrgWebhookDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    if (!user.organizationId) {
      throw new BadRequestException('User does not belong to an organization.');
    }
    return this.webhooksManagementService.createEndpoint(
      user.organizationId,
      dto,
    );
  }

  @Delete(':id')
  @Roles('sysadmin', 'manager')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a webhook endpoint' })
  @ApiResponse({ status: 200, description: 'Webhook deleted.' })
  async deleteEndpoint(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    if (!user.organizationId) {
      throw new BadRequestException('User does not belong to an organization.');
    }
    return this.webhooksManagementService.deleteEndpoint(
      user.organizationId,
      id,
    );
  }
}
