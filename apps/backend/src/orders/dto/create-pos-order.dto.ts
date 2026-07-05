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
    example: 'cash',
    description: 'How the order was paid (detailed processing comes later)',
  })
  @IsIn(['cash', 'card'])
  paymentMethod: string;

  @ApiProperty({ type: [PosOrderItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PosOrderItemDto)
  items: PosOrderItemDto[];
}
