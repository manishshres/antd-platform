import {
  Controller,
  Post,
  Body,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
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
import { ThrottlerGuard, Throttle } from '@nestjs/throttler';
import { Public } from '../common/decorators/public.decorator';

@ApiTags('Public API - Orders')
@ApiSecurity('x-api-key')
@Public() // Authenticated by API key, not JWT (H6).
@UseGuards(ApiKeyAuthGuard, ThrottlerGuard)
@Throttle({ default: { limit: 60, ttl: 60000 } })
@Controller({ version: '2', path: 'orders' })
export class PublicOrdersController {
  constructor(private readonly ordersService: OrdersService) {}

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
    return this.ordersService.createOrderForOrg(
      orgId,
      dto.customerName,
      dto.customerPhone,
      dto.items, // Temp cast if needed, will check further later
    );
  }
}
