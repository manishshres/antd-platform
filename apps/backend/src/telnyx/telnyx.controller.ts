import {
  Controller,
  Get,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { TelnyxService } from './telnyx.service';

@ApiTags('Telnyx')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('telnyx')
export class TelnyxController {
  constructor(private readonly telnyxService: TelnyxService) {}

  @Get('search-numbers')
  @Roles('platform_admin', 'sysadmin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Search available Telnyx phone numbers' })
  @ApiQuery({ name: 'country', required: false, type: String })
  @ApiQuery({ name: 'locality', required: false, type: String })
  searchNumbers(
    @Query('country') _country?: string,
    @Query('locality') _locality?: string,
  ) {
    // This is a stub for the frontend wizard.
    // In a real scenario, this would call Telnyx's /v2/available_phone_numbers API.
    return {
      data: [
        {
          phoneNumber: '+14155552671',
          locality: 'San Francisco',
          country: 'US',
          monthlyCost: 1.5,
        },
        {
          phoneNumber: '+14155558932',
          locality: 'San Francisco',
          country: 'US',
          monthlyCost: 1.5,
        },
        {
          phoneNumber: '+12125550198',
          locality: 'New York',
          country: 'US',
          monthlyCost: 2.0,
        },
      ],
    };
  }

  @Get('agent-templates')
  @Roles('platform_admin', 'sysadmin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List default AI voice agent templates' })
  async listAgentTemplates() {
    return {
      data: [
        {
          id: 'restaurant-host',
          name: 'Restaurant Host',
          description: 'Handles reservations, menu inquiries, and wait times.',
        },
        {
          id: 'customer-support',
          name: 'Customer Support',
          description: 'General FAQ and routing.',
        },
        {
          id: 'sales-rep',
          name: 'Outbound Sales',
          description: 'Lead qualification.',
        },
      ],
    };
  }
}
