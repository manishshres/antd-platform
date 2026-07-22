import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
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
import { CreateIntegrationAccountDto } from './dto/create-integration-account.dto';

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
