import {
  IsNotEmpty,
  IsString,
  IsArray,
  IsIn,
  IsOptional,
  IsUUID,
  ValidateNested,
  IsNumber,
  IsBoolean,
  Min,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { PAYMENT_METHODS } from '../payment-methods';

export class PosOrderItemDto {
  @ApiProperty({ description: 'Menu Item UUID' })
  @IsUUID()
  @IsNotEmpty()
  menuItemId: string;

  @ApiProperty({ example: 2, description: 'Quantity ordered' })
  @IsNumber()
  @Min(1)
  quantity: number;

  @ApiProperty({
    required: false,
    description: 'Selected modifier option UUIDs (menu_item_modifiers ids)',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  optionIds?: string[];

  @ApiProperty({ required: false, description: 'Per-item kitchen note' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @ApiProperty({
    required: false,
    description: 'Course number (1 for Appetizer, 2 for Main)',
  })
  @IsOptional()
  @IsNumber()
  course?: number;

  @ApiProperty({
    required: false,
    description:
      'Manager-authorized replacement unit price in cents (0 = comped). Overrides the ' +
      'menu price and any modifier price adjustments for this line only — the menu item ' +
      'itself is unchanged. The POS gates this behind a manager PIN before sending it.',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  priceOverride?: number;

  @ApiProperty({
    required: false,
    description:
      'Free-text reason for the price override (e.g. "customer complaint, comped dessert").',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  priceOverrideReason?: string;
}

export class CreatePosOrderDto {
  @ApiProperty({ description: 'Location UUID' })
  @IsUUID()
  @IsNotEmpty()
  locationId: string;

  @ApiProperty({
    required: false,
    example: 'Walk-in',
    description: 'Customer name (defaults to Walk-in)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  customerName?: string;

  @ApiProperty({ required: false, description: 'Customer phone' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  customerPhone?: string;

  @ApiProperty({ required: false, description: 'Linked customer profile id' })
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiProperty({ required: false, description: 'Table ID' })
  @IsOptional()
  @IsUUID()
  tableId?: string;

  @ApiProperty({
    required: false,
    example: 'dine_in',
    description: 'Fulfilment type',
  })
  @IsOptional()
  @IsIn(['dine_in', 'pickup', 'delivery'])
  orderType?: string;

  @ApiProperty({ required: false, description: 'Order-level kitchen note' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  specialInstructions?: string;

  @ApiProperty({
    required: false,
    example: 'cash',
    description:
      'How the order was paid. Omit to save the order unpaid (dine-in / pay-later): ' +
      'the kitchen ticket still fires and payment is recorded later via /orders/:id/pay.',
  })
  @IsOptional()
  @IsIn(PAYMENT_METHODS)
  paymentMethod?: string;

  @ApiProperty({ required: false, description: 'Tip in cents' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  tipAmount?: number;

  @ApiProperty({
    required: false,
    description:
      "Opt in to the location's configured auto-gratuity/service-charge rate",
  })
  @IsOptional()
  @IsBoolean()
  applyServiceCharge?: boolean;

  @ApiProperty({
    required: false,
    description:
      'Loyalty points to redeem toward this order (1 point = 1 cent). Requires customerId.',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  redeemPoints?: number;

  @ApiProperty({ required: false, description: 'Applied discount id' })
  @IsOptional()
  @IsUUID()
  discountId?: string;

  @ApiProperty({ required: false, description: 'Promo code to apply' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  promoCode?: string;

  @ApiProperty({
    required: false,
    example: 'all',
    description:
      "How the order reaches the kitchen. 'all' (default) prints every line " +
      "on save. 'by_course' holds the ticket and prints one per course as " +
      'the register fires it (course 1 fires automatically on creation).',
  })
  @IsOptional()
  @IsIn(['all', 'by_course'])
  fireMode?: string;

  @ApiProperty({ type: [PosOrderItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PosOrderItemDto)
  items: PosOrderItemDto[];

  @ApiProperty({
    required: false,
    description: 'Idempotency key for offline POS creation',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  clientOrderId?: string;
}
