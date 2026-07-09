import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Param,
  UseGuards,
} from '@nestjs/common';
import { CustomersService } from './customers.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../common/decorators/current-user.decorator';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';

@ApiTags('Customers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('customers')
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Get('search')
  @ApiOperation({ summary: 'Search customers by name or phone' })
  async searchCustomers(
    @CurrentUser() user: CurrentUserPayload,
    @Query('q') query: string,
  ) {
    return this.customersService.searchCustomers(user, query);
  }

  @Get(':id/history')
  @ApiOperation({ summary: 'Get customer order history' })
  async getCustomerHistory(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ) {
    return this.customersService.getCustomerHistory(user, id);
  }

  @Post()
  @ApiOperation({ summary: 'Create or update a customer profile' })
  async upsertCustomer(
    @CurrentUser() user: CurrentUserPayload,
    @Body()
    body: { name: string; phone?: string; email?: string; notes?: string },
  ) {
    return this.customersService.upsertCustomer(user, body);
  }
}
