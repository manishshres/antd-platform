import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  Res,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { RecordingsService } from './recordings.service';
import { PaginationDto } from '../common/dto/pagination.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../common/decorators/current-user.decorator';

@ApiTags('Recordings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('recordings')
export class RecordingsController {
  constructor(private readonly recordingsService: RecordingsService) {}

  @Get()
  @Roles('manager')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List recordings with optional full-text search' })
  @ApiQuery({ name: 'locationId', required: false, type: String })
  @ApiQuery({ name: 'search', required: false, type: String })
  async listRecordings(
    @CurrentUser() user: CurrentUserPayload,
    @Query() pagination: PaginationDto,
    @Query('locationId') locationId?: string,
    @Query('search') search?: string,
  ) {
    return this.recordingsService.listRecordings(
      user,
      pagination,
      locationId,
      search,
    );
  }

  @Get(':id')
  @Roles('manager')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get details of a specific recording' })
  async getRecording(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ) {
    return this.recordingsService.getRecording(user, id);
  }

  @Delete(':id')
  @Roles('manager')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soft delete a recording for GDPR compliance' })
  async deleteRecording(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ) {
    return this.recordingsService.deleteRecording(user, id);
  }

  @Post(':id/sync')
  @Roles('manager')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Manually trigger recording sync from Telnyx' })
  async syncRecording(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Query('locationId') locationId?: string,
  ) {
    return this.recordingsService.syncRecording(user, id, locationId);
  }

  @Get(':id/export')
  @Roles('manager')
  @ApiOperation({ summary: 'Export transcript as CSV or TXT' })
  @ApiQuery({
    name: 'format',
    required: false,
    type: String,
    description: 'csv or txt',
  })
  async exportTranscript(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Query('format') format: string = 'csv',
    @Res() res: import('express').Response,
  ) {
    const exported = await this.recordingsService.exportRecording(
      user,
      id,
      format,
    );

    res.setHeader('Content-Type', exported.contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename=${exported.filename}`,
    );
    res.send(exported.data);
  }
}
