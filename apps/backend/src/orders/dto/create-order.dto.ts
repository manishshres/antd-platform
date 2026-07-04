import {
  IsNotEmpty,
  IsString,
  IsArray,
  ValidateNested,
  IsNumber,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class OrderItemDto {
  @ApiProperty({
    example: 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d',
    description: 'Menu Item UUID',
  })
  @IsString()
  @IsNotEmpty()
  menuItemId: string;

  @ApiProperty({ example: 2, description: 'Quantity ordered' })
  @IsNumber()
  @Min(1)
  @IsNotEmpty()
  quantity: number;
}

export class CreateOrderDto {
  @ApiProperty({
    example: 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d',
    description: 'Location UUID',
  })
  @IsString()
  @IsNotEmpty()
  locationId: string;

  @ApiProperty({ example: 'John Doe', description: 'Customer Name' })
  @IsString()
  @IsNotEmpty()
  customerName: string;

  @ApiProperty({
    example: '+15551234567',
    description: 'Customer Phone Number',
  })
  @IsString()
  @IsNotEmpty()
  customerPhone: string;

  @ApiProperty({ type: [OrderItemDto], description: 'List of order items' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items: OrderItemDto[];
}
