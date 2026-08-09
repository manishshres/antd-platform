import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  UseGuards,
  BadRequestException,
  HttpCode,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { PrintJobsService } from './print-jobs.service';
import { BillingService } from '../billing/billing.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../common/decorators/current-user.decorator';

@ApiTags('Print Jobs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('print-jobs')
export class PrintJobsController {
  constructor(
    private readonly printJobsService: PrintJobsService,
    private readonly billingService: BillingService,
  ) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'List print job history for the current organization',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['queued', 'retrying', 'sent', 'failed'],
  })
  @ApiQuery({ name: 'jobType', required: false, enum: ['kitchen', 'receipt'] })
  @ApiResponse({ status: 200, description: 'Returns print job history.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  async getPrintJobs(
    @CurrentUser() user: CurrentUserPayload,
    @Query('status') status?: string,
    @Query('jobType') jobType?: string,
  ): Promise<unknown> {
    const organizationId = await this.billingService.getRequiredOrg(user);

    return this.printJobsService.listPrintJobs(organizationId, {
      status,
      jobType,
    });
  }

  @Get('dead-letter')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'List permanently failed print jobs (dead-letter queue)',
    description: `Returns all print jobs that have failed and exhausted their retry attempts.
    Use POST /print-jobs/:id/requeue to retry them.`,
  })
  @ApiResponse({ status: 200, description: 'Returns dead-letter print jobs.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  async getDeadLetterJobs(
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<unknown> {
    const organizationId = await this.billingService.getRequiredOrg(user);

    return this.printJobsService.getDeadLetterJobs(organizationId);
  }

  @Post(':id/requeue')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Requeue a failed print job for retry',
    description: 'Resets the job status and re-adds it to the print queue.',
  })
  @ApiResponse({ status: 200, description: 'Print job requeued.' })
  @ApiResponse({ status: 404, description: 'Print job not found.' })
  async requeueJob(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ): Promise<unknown> {
    const organizationId = await this.billingService.getRequiredOrg(user);
    if (!id) {
      throw new BadRequestException('Print job ID is required.');
    }

    return this.printJobsService.requeueJob(id, organizationId);
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get a single print job record' })
  @ApiResponse({ status: 200, description: 'Returns a print job detail.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 404, description: 'Print job not found.' })
  async getPrintJobById(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ): Promise<unknown> {
    if (!id) {
      throw new BadRequestException('Print job ID is required.');
    }

    const organizationId = await this.billingService.getRequiredOrg(user);

    try {
      return await this.printJobsService.getOrganizationPrintJobById(
        organizationId,
        id,
      );
    } catch (err: unknown) {
      if (err instanceof Error && err.message === 'Print job not found.') {
        throw new NotFoundException(err.message);
      }
      throw err;
    }
  }
}
