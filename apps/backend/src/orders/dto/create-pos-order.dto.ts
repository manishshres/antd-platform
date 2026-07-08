import {
  IsNotEmpty,
  IsString,
  IsArray,
  IsIn,
  IsOptional,
  IsUUID,
  ValidateNested,
  IsNumber,
  Min,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

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
  @IsIn(['cash', 'card'])
  paymentMethod?: string;

  @ApiProperty({ required: false, description: 'Tip in cents' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  tipAmount?: number;

  @ApiProperty({ required: false, description: 'Applied discount id' })
  @IsOptional()
  @IsUUID()
  discountId?: string;

  @ApiProperty({ required: false, description: 'Promo code to apply' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  promoCode?: string;

  @ApiProperty({ type: [PosOrderItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PosOrderItemDto)
  items: PosOrderItemDto[];
}
