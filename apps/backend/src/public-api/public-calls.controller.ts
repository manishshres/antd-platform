import {
  Controller,
  Get,
  Param,
  Query,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
} from '@nestjs/swagger';
import { ApiKeyAuthGuard } from './guards/api-key-auth.guard';
import { CallsService } from '../calls/calls.service';
import { CallListQueryDto } from '../calls/dto/call-list-query.dto';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../common/decorators/public.decorator';
import { apiPrincipal } from './api-principal';

@ApiTags('Public API - Calls')
@ApiSecurity('x-api-key')
@Public() // Authenticated by API key, not JWT.
@SkipThrottle()
@UseGuards(ApiKeyAuthGuard)
@Controller({ version: '2', path: 'calls' })
export class PublicCallsController {
  constructor(private readonly callsService: CallsService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'List call recordings with transcripts for the organization (POS call-history view)',
  })
  @ApiResponse({ status: 200, description: 'Returns enriched call list.' })
  @ApiResponse({ status: 401, description: 'Unauthorized. Invalid API key.' })
  async listCalls(
    @Req() request: import('express').Request & { organizationId: string },
    @Query() query: CallListQueryDto,
  ) {
    return this.callsService.listCalls(
      apiPrincipal(request.organizationId),
      query,
      query.search,
    );
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get a single call detail (incl. transcript)' })
  @ApiResponse({ status: 200, description: 'Returns call detail.' })
  @ApiResponse({ status: 401, description: 'Unauthorized. Invalid API key.' })
  @ApiResponse({ status: 404, description: 'Call not found.' })
  async getCall(
    @Req() request: import('express').Request & { organizationId: string },
    @Param('id') id: string,
  ) {
    if (!id) throw new BadRequestException('Call ID is required.');
    return this.callsService.getCall(id, request.organizationId);
  }

  @Get(':id/messages')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get the conversation transcript messages for a specific call',
  })
  @ApiResponse({ status: 200, description: 'Returns conversation messages.' })
  @ApiResponse({ status: 401, description: 'Unauthorized. Invalid API key.' })
  async getCallMessages(
    @Req() request: import('express').Request & { organizationId: string },
    @Param('id') id: string,
  ) {
    if (!id) throw new BadRequestException('Call ID is required.');
    return this.callsService.getCallMessages(id, request.organizationId);
  }
}
