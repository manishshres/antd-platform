import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Param,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
} from '@nestjs/swagger';
import { ApiKeyAuthGuard } from './guards/api-key-auth.guard';
import { OrdersService } from '../orders/orders.service';
import { CreateOrderDto } from '../orders/dto/create-order.dto';
import { CreatePosOrderDto } from '../orders/dto/create-pos-order.dto';
import { GetOrdersDto } from '../orders/dto/get-orders.dto';
import { OrderReportDto } from '../orders/dto/order-report.dto';
import { GetOrderSummaryDto } from './dto/get-order-summary.dto';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../common/decorators/public.decorator';
import { apiPrincipal } from './api-principal';

@ApiTags('Public API - Orders')
@ApiSecurity('x-api-key')
@Public() // Authenticated by API key, not JWT (H6).
@SkipThrottle()
@UseGuards(ApiKeyAuthGuard)
@Controller({ version: '2', path: 'orders' })
export class PublicOrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get('summary')
  @ApiOperation({
    summary:
      'Transaction summary (open, sales, refund totals) for a location and date range',
  })
  @ApiResponse({ status: 200, description: 'Order summary.' })
  @ApiResponse({ status: 401, description: 'Unauthorized. Invalid API key.' })
  async getOrderSummary(
    @Req() request: import('express').Request & { organizationId: string },
    @Query() query: GetOrderSummaryDto,
  ) {
    return this.ordersService.getTransactionSummary(
      apiPrincipal(request.organizationId),
      query.locationId,
      query.dateFrom,
      query.dateTo,
    );
  }

  @Get('reports')
  @ApiOperation({
    summary: 'Sales report with time series and breakdowns for a location',
  })
  @ApiResponse({ status: 200, description: 'Order report.' })
  @ApiResponse({ status: 401, description: 'Unauthorized. Invalid API key.' })
  async getOrderReport(
    @Req() request: import('express').Request & { organizationId: string },
    @Query() query: OrderReportDto,
  ) {
    return this.ordersService.getOrderReport(
      apiPrincipal(request.organizationId),
      { ...query, orgId: undefined },
    );
  }

  @Get()
  @ApiOperation({ summary: 'List orders (history) for the organization' })
  @ApiResponse({ status: 200, description: 'Paginated order list.' })
  @ApiResponse({ status: 401, description: 'Unauthorized. Invalid API key.' })
  async getOrders(
    @Req() request: import('express').Request & { organizationId: string },
    @Query() query: GetOrdersDto,
  ) {
    return this.ordersService.getOrders(
      apiPrincipal(request.organizationId),
      query,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single order with its items' })
  @ApiResponse({ status: 200, description: 'Order detail.' })
  @ApiResponse({ status: 401, description: 'Unauthorized. Invalid API key.' })
  async getOrderById(
    @Req() request: import('express').Request & { organizationId: string },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.ordersService.getOrderByIdForOrg(request.organizationId, id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new order programmatically' })
  @ApiResponse({ status: 201, description: 'Order created successfully.' })
  @ApiResponse({ status: 401, description: 'Unauthorized. Invalid API key.' })
  async createOrder(
    @Req() request: import('express').Request & { organizationId: string },
    @Body() dto: CreateOrderDto,
  ) {
    const orgId = request.organizationId;
    // We assume public API orders are made on behalf of a guest/external source
    // They are not strictly tied to a user account unless provided in metadata
    const order = await this.ordersService.createOrderForOrg(
      orgId,
      dto.customerName || 'Walk-in',
      dto.customerPhone || '',
      dto.items,
      undefined,
      undefined,
      undefined,
      undefined,
      dto.clientOrderId,
    );

    // Report the order's actual status — createOrderForOrg creates 'pending',
    // not 'confirmed'; the AI script reads dynamic_variables.order_status.
    return {
      message: 'Order created successfully.',
      order_status: order.status,
      dynamic_variables: {
        order_status: order.status,
      },
      data: order,
    };
  }

  @Post('pos')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Create a POS order (server-side pricing; idempotent via clientOrderId for offline sync)',
  })
  @ApiResponse({ status: 201, description: 'Order created (or replayed).' })
  @ApiResponse({ status: 401, description: 'Unauthorized. Invalid API key.' })
  async createPosOrder(
    @Req() request: import('express').Request & { organizationId: string },
    @Body() dto: CreatePosOrderDto,
  ) {
    return this.ordersService.createPosOrder(
      apiPrincipal(request.organizationId),
      dto,
    );
  }
}
