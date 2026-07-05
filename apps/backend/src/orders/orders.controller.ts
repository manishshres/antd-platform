import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
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
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { CreatePosOrderDto } from './dto/create-pos-order.dto';
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

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get a single order with items' })
  @ApiResponse({ status: 200, description: 'Returns order details.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 404, description: 'Order not found.' })
  async getOrderById(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ): Promise<unknown> {
    if (!id) throw new BadRequestException('Order ID is required.');
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
      dto.customerName,
      dto.customerPhone,
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
    @Param('id') id: string,
    @Body() dto: UpdateStatusDto,
  ): Promise<unknown> {
    if (!id) throw new BadRequestException('Order ID is required.');
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
    @Param('id') id: string,
    @Query('status') status?: string,
    @Query('jobType') jobType?: string,
  ): Promise<unknown> {
    if (!id) throw new BadRequestException('Order ID is required.');

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
    @Param('id') id: string,
    @Body() dto: PrintOrderDto,
  ): Promise<unknown> {
    if (!id) throw new BadRequestException('Order ID is required.');
    return this.ordersService.printOrder(user, id, dto.printerId);
  }
}
