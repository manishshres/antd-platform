import { Controller, Get, UseGuards, Req } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
} from '@nestjs/swagger';
import { ApiKeyAuthGuard } from './guards/api-key-auth.guard';
import { LocationsService } from '../locations/locations.service';
import { ThrottlerGuard, SkipThrottle } from '@nestjs/throttler';
import { Public } from '../common/decorators/public.decorator';

@ApiTags('Public API - Locations')
@ApiSecurity('x-api-key')
@Public() // Authenticated by API key, not JWT.
@SkipThrottle()
@UseGuards(ApiKeyAuthGuard)
@Controller({ version: '2', path: 'locations' })
export class PublicLocationsController {
  constructor(private readonly locationsService: LocationsService) {}

  @Get()
  @ApiOperation({ summary: 'List the locations of the organization' })
  @ApiResponse({ status: 200, description: 'Returns active locations.' })
  @ApiResponse({ status: 401, description: 'Unauthorized. Invalid API key.' })
  async listLocations(
    @Req() request: import('express').Request & { organizationId: string },
  ) {
    return this.locationsService.listLocations(request.organizationId);
  }
}
