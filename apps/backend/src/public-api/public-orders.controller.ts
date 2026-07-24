import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Body,
  Query,
  Param,
  UseGuards,
  Req,
  Headers,
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
import { AppendOrderItemsDto } from '../orders/dto/append-order-items.dto';
import { PayOrderDto } from '../orders/dto/pay-order.dto';
import { FireCourseDto } from '../orders/dto/fire-course.dto';
import { GetOrdersDto } from '../orders/dto/get-orders.dto';
import { OrderReportDto } from '../orders/dto/order-report.dto';
import { RecordPaymentDto } from '../orders/dto/record-payment.dto';
import { RefundOrderDto } from '../orders/dto/refund-order.dto';
import { PartialRefundDto } from '../orders/dto/partial-refund.dto';
import { AdjustOrderItemsDto } from '../orders/dto/adjust-order-items.dto';
import { UpdateStatusDto } from '../orders/dto/update-status.dto';
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
    const order = await this.ordersService.getOrderByIdForOrg(
      request.organizationId,
      id,
    );
    // The shared service method names item fields for the web app
    // (`menuItemName`, `price`); the POS client's ServerOrderDetail expects
    // `name`/`unitPrice`. Without this mapping the POS showed order lines with
    // blank names and broken prices ("missing menu items"). Reshape to the
    // client contract here rather than renaming in the service, which the JWT
    // web path also consumes.
    return {
      ...order,
      items: order.items.map((item) => ({
        id: item.id,
        menuItemId: item.menuItemId,
        name: item.menuItemName,
        quantity: item.quantity,
        unitPrice: item.price,
        notes: item.notes,
        course: item.course,
        firedAt: item.firedAt,
        modifiers: item.modifiers,
      })),
    };
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

  @Post(':id/items')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Append items to an open tab (delta, not a replacement; idempotent via clientMutationId)',
  })
  @ApiResponse({ status: 200, description: 'Items appended (or replayed).' })
  @ApiResponse({ status: 400, description: 'Order is paid or not editable.' })
  @ApiResponse({ status: 401, description: 'Unauthorized. Invalid API key.' })
  async appendOrderItems(
    @Req() request: import('express').Request & { organizationId: string },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AppendOrderItemsDto,
  ) {
    return this.ordersService.appendOrderItems(
      apiPrincipal(request.organizationId),
      id,
      dto,
    );
  }

  @Post(':id/fire')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Fire one course of a coursed order to the kitchen (idempotent via clientMutationId)',
  })
  @ApiResponse({ status: 200, description: 'Course fired (or already fired).' })
  @ApiResponse({ status: 400, description: 'Order is paid or not fireable.' })
  @ApiResponse({ status: 401, description: 'Unauthorized. Invalid API key.' })
  async fireCourse(
    @Req() request: import('express').Request & { organizationId: string },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: FireCourseDto,
  ) {
    return this.ordersService.fireCourse(
      apiPrincipal(request.organizationId),
      id,
      dto,
    );
  }

  @Post(':id/pay')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Settle an open tab (cash or card)' })
  @ApiResponse({ status: 200, description: 'Payment recorded.' })
  @ApiResponse({ status: 400, description: 'Order already paid.' })
  @ApiResponse({ status: 401, description: 'Unauthorized. Invalid API key.' })
  async payOrder(
    @Req() request: import('express').Request & { organizationId: string },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PayOrderDto,
  ) {
    return this.ordersService.payOrder(
      apiPrincipal(request.organizationId),
      id,
      dto.paymentMethod,
      dto.tipAmount,
    );
  }

  @Post(':id/payments')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Record a partial payment (split checks) against an unpaid order',
  })
  @ApiResponse({
    status: 200,
    description:
      'Payment recorded; returns applied/changeGiven/remaining/paid.',
  })
  @ApiResponse({
    status: 400,
    description: 'Order paid, cancelled, or invalid amount.',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized. Invalid API key.' })
  @ApiResponse({ status: 404, description: 'Order not found.' })
  async recordPayment(
    @Req() request: import('express').Request & { organizationId: string },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RecordPaymentDto,
  ) {
    return this.ordersService.recordPayment(
      apiPrincipal(request.organizationId),
      id,
      dto,
    );
  }

  @Post(':id/refund')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Void and refund a paid order using manager PIN' })
  @ApiResponse({ status: 200, description: 'Order voided and refunded.' })
  @ApiResponse({ status: 400, description: 'Order not paid or invalid state.' })
  @ApiResponse({ status: 401, description: 'Unauthorized. Invalid API key.' })
  @ApiResponse({ status: 403, description: 'Invalid manager PIN.' })
  @ApiResponse({ status: 404, description: 'Order not found.' })
  async refundOrder(
    @Req() request: import('express').Request & { organizationId: string },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RefundOrderDto,
  ) {
    return this.ordersService.refundPaidOrder(
      apiPrincipal(request.organizationId),
      id,
      dto.managerPin,
      dto.reason,
    );
  }

  @Post(':id/refund-partial')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Partially refund a paid order using manager PIN' })
  @ApiResponse({ status: 200, description: 'Order partially refunded.' })
  @ApiResponse({
    status: 400,
    description: 'Order not paid or invalid amount.',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized. Invalid API key.' })
  @ApiResponse({ status: 403, description: 'Invalid manager PIN.' })
  @ApiResponse({ status: 404, description: 'Order not found.' })
  async partialRefundOrder(
    @Req() request: import('express').Request & { organizationId: string },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PartialRefundDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.ordersService.refundPartialOrder(
      apiPrincipal(request.organizationId),
      id,
      dto,
      idempotencyKey,
    );
  }

  @Put(':id/adjust')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Adjust items in a closed order using manager PIN' })
  @ApiResponse({ status: 200, description: 'Order items adjusted.' })
  @ApiResponse({ status: 401, description: 'Unauthorized. Invalid API key.' })
  @ApiResponse({ status: 403, description: 'Invalid manager PIN.' })
  @ApiResponse({ status: 404, description: 'Order not found.' })
  async adjustOrderItems(
    @Req() request: import('express').Request & { organizationId: string },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdjustOrderItemsDto,
  ) {
    return this.ordersService.adjustOrderItems(
      apiPrincipal(request.organizationId),
      id,
      dto,
    );
  }

  @Patch(':id/status')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Change order status (e.g. pickup/delivery lifecycle: preparing, ready, delivered)',
  })
  @ApiResponse({ status: 200, description: 'Order status updated.' })
  @ApiResponse({ status: 401, description: 'Unauthorized. Invalid API key.' })
  @ApiResponse({ status: 404, description: 'Order not found.' })
  async updateOrderStatus(
    @Req() request: import('express').Request & { organizationId: string },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStatusDto,
  ) {
    return this.ordersService.updateOrderStatus(
      apiPrincipal(request.organizationId),
      id,
      dto.status,
    );
  }

  @Post(':id/print')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reprint the kitchen ticket / receipt for an order',
  })
  @ApiResponse({ status: 200, description: 'Print job(s) queued.' })
  @ApiResponse({ status: 401, description: 'Unauthorized. Invalid API key.' })
  @ApiResponse({ status: 404, description: 'Order not found.' })
  async printOrder(
    @Req() request: import('express').Request & { organizationId: string },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { printerId?: string },
  ) {
    return this.ordersService.printOrder(
      apiPrincipal(request.organizationId),
      id,
      body?.printerId,
    );
  }
}
