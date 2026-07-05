import {
  Controller,
  Get,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
  Res,
  BadRequestException,
  NotFoundException,
  Query,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import * as express from 'express';
import { CallsService } from './calls.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../common/decorators/current-user.decorator';
import { PaginationDto } from '../common/dto/pagination.dto';
import { PaginatedResponseDto } from '../common/dto/paginated-response.dto';

@ApiTags('Calls')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('calls')
export class CallsController {
  constructor(private readonly callsService: CallsService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'List all call recordings with transcripts for the authenticated organization',
  })
  @ApiResponse({ status: 200, description: 'Returns enriched call list.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  async listCalls(
    @CurrentUser() user: CurrentUserPayload,
    @Query() pagination: PaginationDto,
    @Query('search') search?: string,
  ): Promise<PaginatedResponseDto<unknown>> {
    return this.callsService.listCalls(user, pagination, search);
  }

  @Get('export')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Export calls to CSV' })
  @ApiResponse({ status: 200, description: 'Returns CSV of calls.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  async exportCalls(
    @CurrentUser() user: CurrentUserPayload,
    @Res() res: express.Response,
  ) {
    const csv = await this.callsService.exportCallsCsv(user.organizationId);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename=calls-export.csv',
    );
    return res.send(csv);
  }

  @Get('export/excel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Export calls to Excel' })
  @ApiResponse({ status: 200, description: 'Returns Excel file of calls.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  async exportCallsExcel(
    @CurrentUser() user: CurrentUserPayload,
    @Res() res: express.Response,
  ) {
    const buffer = await this.callsService.exportCallsExcel(
      user.organizationId,
    );
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      'attachment; filename=calls-export.xlsx',
    );
    return res.send(buffer);
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get a single call detail' })
  @ApiResponse({ status: 200, description: 'Returns call detail.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 404, description: 'Call not found.' })
  async getCall(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ) {
    if (!id) throw new BadRequestException('Call ID is required.');
    return this.callsService.getCall(id, user.organizationId);
  }

  @Get(':id/messages')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get conversation messages for a specific call',
  })
  @ApiResponse({ status: 200, description: 'Returns conversation messages.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  async getCallMessages(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ) {
    if (!id) throw new BadRequestException('Call ID is required.');
    return this.callsService.getCallMessages(id, user.organizationId);
  }

  @Get(':id/recording')
  @ApiOperation({ summary: 'Stream the audio recording for a call' })
  @ApiResponse({ status: 200, description: 'Streams audio binary.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 404, description: 'Recording not found.' })
  async getRecording(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Res() res: express.Response,
  ) {
    if (!id) throw new BadRequestException('Call ID is required.');

    try {
      const stream = await this.callsService.getRecordingStream(
        id,
        user.organizationId,
      );
      res.setHeader('Content-Type', 'audio/wav');
      stream.pipe(res);
    } catch (err) {
      if (err instanceof NotFoundException) {
        throw err;
      }
      throw new NotFoundException('Recording audio is not available.');
    }
  }
}
