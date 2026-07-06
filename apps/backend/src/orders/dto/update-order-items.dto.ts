import {
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { PosOrderItemDto } from './create-pos-order.dto';

export class UpdateOrderItemsDto {
  @ApiProperty({ required: false, description: 'Customer name' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  customerName?: string;

  @ApiProperty({ required: false, example: 'pickup' })
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
    description: 'Discount to apply; omit both fields to clear the discount',
  })
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
