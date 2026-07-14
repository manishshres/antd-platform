import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
} from '@nestjs/swagger';
import { ApiKeyAuthGuard } from './guards/api-key-auth.guard';
import { CustomersService } from '../customers/customers.service';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../common/decorators/public.decorator';
import { apiPrincipal } from './api-principal';
import { UpsertCustomerDto } from './dto/upsert-customer.dto';

@ApiTags('Public API - Customers')
@ApiSecurity('x-api-key')
@Public() // Authenticated by API key, not JWT.
@SkipThrottle()
@UseGuards(ApiKeyAuthGuard)
@Controller({ version: '2', path: 'customers' })
export class PublicCustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Get()
  @ApiOperation({
    summary: 'List recent customers, or search by name/phone with ?search=',
  })
  @ApiResponse({ status: 200, description: 'Returns customers.' })
  @ApiResponse({ status: 401, description: 'Unauthorized. Invalid API key.' })
  async listCustomers(
    @Req() request: import('express').Request & { organizationId: string },
    @Query('search') search?: string,
    @Query('limit') limit?: string,
  ) {
    const principal = apiPrincipal(request.organizationId);
    if (search?.trim()) {
      return this.customersService.searchCustomers(principal, search);
    }
    return this.customersService.listRecentCustomers(
      principal,
      limit ? Number(limit) : undefined,
    );
  }

  @Post()
  @ApiOperation({
    summary: 'Create or update a customer profile (upsert by phone)',
  })
  @ApiResponse({ status: 201, description: 'Customer created or updated.' })
  @ApiResponse({ status: 401, description: 'Unauthorized. Invalid API key.' })
  async upsertCustomer(
    @Req() request: import('express').Request & { organizationId: string },
    @Body() dto: UpsertCustomerDto,
  ) {
    return this.customersService.upsertCustomer(
      apiPrincipal(request.organizationId),
      dto,
    );
  }
}
