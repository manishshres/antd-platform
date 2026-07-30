import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../common/decorators/current-user.decorator';
import { AggregatorService } from './aggregator.service';
import {
  CreateIntegrationAccountDto,
  UpdateIntegrationAccountDto,
} from './dto/create-integration-account.dto';
import { EnableUberIntegrationDto } from './dto/ubereats-integration.dto';

/**
 * Internal, JWT-scoped API for managing marketplace integrations and acting on
 * imported orders. Everything is scoped to the caller's organization.
 */
@ApiTags('Aggregator')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('aggregator')
export class AggregatorController {
  constructor(private readonly aggregatorService: AggregatorService) {}

  private orgId(user: CurrentUserPayload): string {
    if (!user.organizationId) {
      throw new BadRequestException('No organization in context.');
    }
    return user.organizationId;
  }

  @Get('integration-accounts')
  @ApiOperation({ summary: 'List the org’s marketplace integration accounts' })
  async listAccounts(@CurrentUser() user: CurrentUserPayload) {
    return this.aggregatorService.listIntegrationAccounts(this.orgId(user));
  }

  @Post('integration-accounts')
  @Roles('owner', 'admin', 'manager')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Connect a marketplace (stores encrypted credentials)',
  })
  @ApiResponse({ status: 201, description: 'Integration account created.' })
  async createAccount(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: CreateIntegrationAccountDto,
  ) {
    return this.aggregatorService.createIntegrationAccount(
      this.orgId(user),
      dto,
    );
  }

  @Patch('integration-accounts/:id')
  @Roles('owner', 'admin', 'manager')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Update marketplace account settings (e.g. auto-accept toggle)',
  })
  async updateAccount(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateIntegrationAccountDto,
  ) {
    return this.aggregatorService.updateIntegrationAccount(
      this.orgId(user),
      id,
      dto,
    );
  }

  @Delete('integration-accounts/:id')
  @Roles('owner', 'admin', 'manager')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Disconnect a marketplace (deletes the stored credentials)',
  })
  async deleteAccount(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.aggregatorService.deleteIntegrationAccount(
      this.orgId(user),
      id,
    );
  }

  @Get('orders')
  @ApiOperation({ summary: 'List imported marketplace orders' })
  async listOrders(
    @CurrentUser() user: CurrentUserPayload,
    @Query('limit') limit?: string,
  ) {
    return this.aggregatorService.listMarketplaceOrders(
      this.orgId(user),
      limit ? Number(limit) : undefined,
    );
  }

  @Post('orders/:id/accept')
  @Roles('owner', 'admin', 'manager', 'agent')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Accept a marketplace order (confirms on the provider)',
  })
  async acceptOrder(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.aggregatorService.acceptOrder(this.orgId(user), id);
  }

  @Post('orders/:id/cancel')
  @Roles('owner', 'admin', 'manager')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancel a marketplace order (cancels on the provider)',
  })
  async cancelOrder(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { reason?: string },
  ) {
    return this.aggregatorService.cancelOrder(
      this.orgId(user),
      id,
      body?.reason,
    );
  }

  @Get('integration-accounts/:id/ubereats/config')
  @Roles('owner', 'admin', 'manager')
  @ApiOperation({
    summary: 'Read the Uber Eats store integration config from Uber',
    description:
      'Proxies GET /v1/eats/stores/{store_id}/pos_data — shows whether Uber has order ' +
      'webhooks enabled, who the order manager is, and the store’s online status.',
  })
  async getUberConfig(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.aggregatorService.getUberStoreConfig(this.orgId(user), id);
  }

  @Post('integration-accounts/:id/ubereats/enable')
  @Roles('owner', 'admin', 'manager')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Enable the Uber Eats POS integration for this store',
    description:
      'Pushes our integration config and sets integration_enabled=true, which is what ' +
      'starts order-fulfillment webhooks on an already-associated store. Idempotent.',
  })
  async enableUberIntegration(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EnableUberIntegrationDto,
  ) {
    return this.aggregatorService.enableUberStoreIntegration(
      this.orgId(user),
      id,
      dto?.merchantStoreId,
    );
  }

  @Post('integration-accounts/:id/ubereats/disable')
  @Roles('owner', 'admin', 'manager')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Pause Uber Eats order webhooks for this store',
  })
  async disableUberIntegration(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.aggregatorService.disableUberStoreIntegration(
      this.orgId(user),
      id,
    );
  }

  @Post('integration-accounts/:id/menu-sync')
  @Roles('owner', 'admin', 'manager')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Push the Coneeko menu to the marketplace' })
  async syncMenu(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.aggregatorService.syncMenu(this.orgId(user), id);
  }
}
