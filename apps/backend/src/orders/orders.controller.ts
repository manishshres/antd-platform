import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { CreatePosOrderDto } from './dto/create-pos-order.dto';
import { UpdateOrderItemsDto } from './dto/update-order-items.dto';
import { PayOrderDto } from './dto/pay-order.dto';
import { RefundOrderDto } from './dto/refund-order.dto';
import { PartialRefundDto } from './dto/partial-refund.dto';
import { AdjustOrderItemsDto } from './dto/adjust-order-items.dto';
import { RecordPaymentDto } from './dto/record-payment.dto';
import { UpdateStatusDto } from './dto/update-status.dto';
import { PrintOrderDto } from './dto/print-order.dto';
import { GetOrdersDto } from './dto/get-orders.dto';
import { PaginatedResponseDto } from '../common/dto/paginated-response.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../common/decorators/current-user.decorator';

@ApiTags('Orders')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'List all restaurant orders for the authenticated organization',
  })
  @ApiResponse({ status: 200, description: 'Returns order list.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  async getOrders(
    @CurrentUser() user: CurrentUserPayload,
    @Query() query: GetOrdersDto,
  ): Promise<PaginatedResponseDto<unknown>> {
    return this.ordersService.getOrders(user, query);
  }

  @Get('summary')
  @Roles('user', 'manager', 'admin', 'sysadmin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Transaction summary metrics for the POS hub' })
  @ApiResponse({ status: 200, description: 'Open/sales/refund totals.' })
  async getTransactionSummary(
    @CurrentUser() user: CurrentUserPayload,
    @Query('locationId') locationId: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ): Promise<unknown> {
    if (!locationId) throw new BadRequestException('locationId is required.');
    return this.ordersService.getTransactionSummary(
      user,
      locationId,
      dateFrom,
      dateTo,
    );
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get a single order with items' })
  @ApiResponse({ status: 200, description: 'Returns order details.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 404, description: 'Order not found.' })
  async getOrderById(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<unknown> {
    return this.ordersService.getOrderById(user, id);
  }

  @Post()
  @Roles('sysadmin')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new customer order' })
  @ApiResponse({ status: 201, description: 'Order created.' })
  @ApiResponse({ status: 400, description: 'Validation failed.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  async createOrder(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: CreateOrderDto,
  ): Promise<unknown> {
    return this.ordersService.createOrder(
      user,
      dto.customerName || 'Walk-in',
      dto.customerPhone || '',
      dto.items,
    );
  }

  @Post('pos')
  @Roles('user', 'manager', 'admin', 'sysadmin')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a paid order from the in-store POS' })
  @ApiResponse({ status: 201, description: 'Order created and paid.' })
  @ApiResponse({ status: 400, description: 'Validation failed.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  async createPosOrder(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: CreatePosOrderDto,
  ): Promise<unknown> {
    return this.ordersService.createPosOrder(user, dto);
  }

  @Put(':id/items')
  @Roles('user', 'manager', 'admin', 'sysadmin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Replace the items of an unpaid order (POS edit / AI handoff)',
  })
  @ApiResponse({ status: 200, description: 'Order updated and re-priced.' })
  @ApiResponse({ status: 400, description: 'Order already paid or closed.' })
  @ApiResponse({ status: 404, description: 'Order not found.' })
  async updateOrderItems(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOrderItemsDto,
  ): Promise<unknown> {
    return this.ordersService.updateOrderItems(user, id, dto);
  }

  @Post(':id/pay')
  @Roles('user', 'manager', 'admin', 'sysadmin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Record payment (cash or card) on an unpaid order' })
  @ApiResponse({ status: 200, description: 'Order marked as paid.' })
  @ApiResponse({ status: 400, description: 'Order already paid or cancelled.' })
  @ApiResponse({ status: 404, description: 'Order not found.' })
  async payOrder(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PayOrderDto,
  ): Promise<unknown> {
    return this.ordersService.payOrder(
      user,
      id,
      dto.paymentMethod,
      dto.tipAmount,
    );
  }

  @Post(':id/refund')
  @Roles('user', 'manager', 'admin', 'sysadmin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Void and refund a paid order using manager PIN' })
  @ApiResponse({ status: 200, description: 'Order voided and refunded.' })
  @ApiResponse({ status: 400, description: 'Order not paid or invalid state.' })
  @ApiResponse({ status: 403, description: 'Invalid manager PIN.' })
  @ApiResponse({ status: 404, description: 'Order not found.' })
  async refundOrder(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RefundOrderDto,
  ): Promise<unknown> {
    return this.ordersService.refundPaidOrder(
      user,
      id,
      dto.managerPin,
      dto.reason,
    );
  }

  @Post(':id/refund-partial')
  @Roles('user', 'manager', 'admin', 'sysadmin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Partially refund a paid order using manager PIN' })
  @ApiResponse({ status: 200, description: 'Order partially refunded.' })
  @ApiResponse({
    status: 400,
    description: 'Order not paid or invalid amount.',
  })
  @ApiResponse({ status: 403, description: 'Invalid manager PIN.' })
  @ApiResponse({ status: 404, description: 'Order not found.' })
  async partialRefundOrder(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PartialRefundDto,
  ): Promise<unknown> {
    return this.ordersService.refundPartialOrder(user, id, dto);
  }

  @Put(':id/adjust')
  @Roles('user', 'manager', 'admin', 'sysadmin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Adjust items in a closed order' })
  @ApiResponse({ status: 200, description: 'Order items adjusted.' })
  @ApiResponse({ status: 403, description: 'Invalid manager PIN.' })
  @ApiResponse({ status: 404, description: 'Order not found.' })
  async adjustOrderItems(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdjustOrderItemsDto,
  ): Promise<unknown> {
    return this.ordersService.adjustOrderItems(user, id, dto);
  }

  @Post(':id/payments')
  @Roles('user', 'manager', 'admin', 'sysadmin')
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
  @ApiResponse({ status: 404, description: 'Order not found.' })
  async recordPayment(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RecordPaymentDto,
  ): Promise<unknown> {
    return this.ordersService.recordPayment(user, id, dto);
  }

  @Patch(':id/status')
  @Roles('sysadmin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update the status of an order' })
  @ApiResponse({ status: 200, description: 'Status updated.' })
  @ApiResponse({ status: 400, description: 'Invalid status.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 404, description: 'Order not found.' })
  async updateOrderStatus(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStatusDto,
  ): Promise<unknown> {
    return this.ordersService.updateOrderStatus(user, id, dto.status);
  }

  @Get(':id/print-jobs')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List print job history for an order' })
  @ApiResponse({ status: 200, description: 'Returns order print job history.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 404, description: 'Order not found.' })
  async getOrderPrintJobs(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('status') status?: string,
    @Query('jobType') jobType?: string,
  ): Promise<unknown> {
    return this.ordersService.getOrderPrintJobs(user, id, {
      status,
      jobType,
    });
  }

  @Post(':id/print')
  @Roles('sysadmin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Enqueue a manual print job for an order' })
  @ApiResponse({ status: 200, description: 'Print jobs enqueued.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 404, description: 'Order not found.' })
  async printOrder(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PrintOrderDto,
  ): Promise<unknown> {
    return this.ordersService.printOrder(user, id, dto.printerId);
  }
}
