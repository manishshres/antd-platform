import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  Param,
  Res,
} from '@nestjs/common';
import * as express from 'express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiProperty,
} from '@nestjs/swagger';
import { BillingService } from './billing.service';
import { CheckoutDto } from './dto/checkout.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PlatformAdminGuard } from '../auth/guards/platform-admin.guard';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../common/decorators/current-user.decorator';
import { IsNotEmpty, IsString, IsUrl } from 'class-validator';

export class PortalDto {
  @ApiProperty({
    example: 'http://localhost:3000/dashboard',
    description: 'The return URL after exiting the Stripe billing portal',
  })
  @IsString()
  @IsNotEmpty()
  @IsUrl({ require_tld: false }, { message: 'Return URL must be a valid URL.' })
  returnUrl: string;
}

@ApiTags('Billing')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('billing')
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @Post('checkout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Create a Stripe Checkout Session for a plan subscription',
  })
  @ApiResponse({
    status: 200,
    description: 'Checkout session created. Returns redirection URL.',
  })
  @ApiResponse({
    status: 400,
    description: 'Validation failed or Stripe error.',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  async createCheckout(
    @CurrentUser() user: CurrentUserPayload,
    @Body() checkoutDto: CheckoutDto,
  ) {
    return this.billingService.createCheckoutSession(user.id, checkoutDto);
  }

  @Post('portal')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Create a Stripe Customer Billing Portal session' })
  @ApiResponse({
    status: 200,
    description: 'Billing Portal session created. Returns redirection URL.',
  })
  @ApiResponse({
    status: 400,
    description: 'Validation failed or Stripe error.',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  async createPortal(
    @CurrentUser() user: CurrentUserPayload,
    @Body() portalDto: PortalDto,
  ) {
    return this.billingService.createPortalSession(
      user.id,
      portalDto.returnUrl,
    );
  }

  @Get('subscription')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get current subscription and plan details' })
  @ApiResponse({
    status: 200,
    description: 'Returns subscription and plan details.',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  async getSubscription(
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<unknown> {
    return this.billingService.getSubscription(user.id);
  }

  @Get('api-key')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get or generate the organization webhook API Key' })
  @ApiResponse({
    status: 200,
    description: 'Returns the webhook API key.',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  async getApiKey(@CurrentUser() user: CurrentUserPayload) {
    return this.billingService.getApiKey(user.id);
  }

  @Post('api-key/rotate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Rotate and generate a new organization webhook API Key',
  })
  @ApiResponse({
    status: 200,
    description: 'Returns the newly generated webhook API key.',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  async rotateApiKey(@CurrentUser() user: CurrentUserPayload) {
    return this.billingService.rotateApiKey(user.id);
  }

  @Get('overview')
  @UseGuards(PlatformAdminGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get platform billing overview (Platform Admin only)',
  })
  @ApiResponse({
    status: 200,
    description: 'Returns aggregated subscriptions and usage.',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  async getBillingOverview() {
    return this.billingService.getBillingOverview();
  }

  @Get('invoices/location/:id/pdf')
  @ApiOperation({
    summary: 'Get a PDF invoice for a specific location',
  })
  @ApiResponse({
    status: 200,
    description: 'Returns the PDF invoice buffer.',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 404, description: 'Location not found.' })
  async getLocationInvoicePdf(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') locationId: string,
    @Res() res: express.Response,
  ) {
    if (!user.organizationId) {
      return res.status(HttpStatus.BAD_REQUEST).send('Organization required.');
    }
    const pdfBuffer = await this.billingService.getLocationInvoicePdf(
      locationId,
      user.organizationId,
    );

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename=invoice-${locationId}.pdf`,
      'Content-Length': pdfBuffer.length,
    });

    res.end(pdfBuffer);
  }

  @Get('locations/:id/margin-report')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get margin report (revenue vs cost) for a location',
  })
  @ApiResponse({
    status: 200,
    description: 'Returns margin details.',
  })
  async getMarginReport(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') locationId: string,
  ) {
    return this.billingService.getMarginReport(user.id, locationId);
  }
}
