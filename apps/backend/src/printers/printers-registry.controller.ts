import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
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
  ApiQuery,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../common/decorators/current-user.decorator';
import { PrintersRegistryService } from './printers-registry.service';
import { CreatePrinterDto } from './dto/create-printer.dto';
import { UpdatePrinterDto } from './dto/update-printer.dto';
import { PaginationDto } from '../common/dto/pagination.dto';
import { PaginatedResponseDto } from '../common/dto/paginated-response.dto';

@ApiTags('Printers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('printers')
export class PrintersRegistryController {
  constructor(
    private readonly printersRegistryService: PrintersRegistryService,
  ) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'List all registered printers for the organization',
  })
  @ApiResponse({
    status: 200,
    description: 'Returns printer list with online status.',
  })
  async listPrinters(
    @CurrentUser() user: CurrentUserPayload,
    @Query() pagination: PaginationDto,
    @Query('locationId') locationId?: string,
  ): Promise<PaginatedResponseDto<unknown>> {
    if (!user.organizationId)
      throw new BadRequestException('Organization required.');
    return this.printersRegistryService.listPrinters(
      user.organizationId,
      pagination,
      locationId,
    );
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register a new printer for the organization' })
  @ApiResponse({ status: 201, description: 'Printer registered.' })
  @ApiResponse({ status: 400, description: 'Validation failed.' })
  async createPrinter(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: CreatePrinterDto,
  ) {
    if (!user.organizationId)
      throw new BadRequestException('Organization required.');
    return this.printersRegistryService.createPrinter(user.organizationId, dto);
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get a single printer by ID' })
  @ApiResponse({ status: 200, description: 'Returns printer details.' })
  @ApiResponse({ status: 404, description: 'Printer not found.' })
  async getPrinter(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ) {
    if (!user.organizationId)
      throw new BadRequestException('Organization required.');
    return this.printersRegistryService.getPrinter(id, user.organizationId);
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update printer configuration' })
  @ApiResponse({ status: 200, description: 'Printer updated.' })
  @ApiResponse({ status: 404, description: 'Printer not found.' })
  async updatePrinter(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: UpdatePrinterDto,
  ) {
    if (!user.organizationId)
      throw new BadRequestException('Organization required.');
    return this.printersRegistryService.updatePrinter(
      id,
      user.organizationId,
      dto,
    );
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove a registered printer (soft delete)' })
  @ApiResponse({ status: 200, description: 'Printer removed.' })
  @ApiResponse({ status: 404, description: 'Printer not found.' })
  async deletePrinter(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ) {
    if (!user.organizationId)
      throw new BadRequestException('Organization required.');
    return this.printersRegistryService.deletePrinter(id, user.organizationId);
  }

  @Post(':id/test-print')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Send a test print job to verify the printer is working',
  })
  @ApiResponse({ status: 200, description: 'Test print command dispatched.' })
  @ApiResponse({ status: 404, description: 'Printer not found.' })
  async testPrint(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ) {
    if (!user.organizationId)
      throw new BadRequestException('Organization required.');
    return this.printersRegistryService.testPrint(id, user.organizationId);
  }

  @Post(':id/restart')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send a restart command to the printer via MQTT' })
  @ApiResponse({ status: 200, description: 'Restart command sent.' })
  @ApiResponse({ status: 404, description: 'Printer not found.' })
  async restartPrinter(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ) {
    if (!user.organizationId)
      throw new BadRequestException('Organization required.');
    return this.printersRegistryService.restartPrinter(id, user.organizationId);
  }

  @Get(':id/queue')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'View pending and failed print jobs for a specific printer',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['queued', 'retrying', 'sent', 'failed'],
  })
  @ApiResponse({
    status: 200,
    description: 'Returns print job queue for the printer.',
  })
  @ApiResponse({ status: 404, description: 'Printer not found.' })
  async getPrinterQueue(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Query('status') status?: string,
  ) {
    if (!user.organizationId)
      throw new BadRequestException('Organization required.');
    return this.printersRegistryService.getPrinterQueue(
      id,
      user.organizationId,
      { status },
    );
  }

  @Post(':id/reprint/:jobId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Retry a specific failed print job on this printer',
  })
  @ApiResponse({ status: 200, description: 'Print job requeued successfully.' })
  @ApiResponse({ status: 404, description: 'Printer or print job not found.' })
  async reprintJob(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') printerId: string,
    @Param('jobId') jobId: string,
  ) {
    if (!user.organizationId)
      throw new BadRequestException('Organization required.');
    return this.printersRegistryService.reprintJob(
      printerId,
      jobId,
      user.organizationId,
    );
  }
}
