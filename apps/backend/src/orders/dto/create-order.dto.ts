import {
  IsArray,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

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

  @ApiPropertyOptional({
    description: 'Course number (1 for Appetizer, 2 for Main)',
  })
  @IsNumber()
  @IsOptional()
  course?: number;
}

export class CreateOrderDto {
  @ApiProperty({
    example: 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d',
    description: 'Location UUID',
  })
  @IsString()
  @IsNotEmpty()
  locationId: string;

  @ApiPropertyOptional({ description: 'Customer ID if linking to a profile' })
  @IsUUID()
  @IsOptional()
  customerId?: string;

  @ApiPropertyOptional({ description: 'Customer Name' })
  @IsString()
  @IsOptional()
  customerName?: string;

  @ApiPropertyOptional({ description: 'Table ID if dining in' })
  @IsUUID()
  @IsOptional()
  tableId?: string;

  @ApiPropertyOptional({
    example: '+15551234567',
    description: 'Customer Phone Number',
  })
  @IsString()
  @IsOptional()
  customerPhone?: string;

  @ApiProperty({ type: [OrderItemDto], description: 'List of order items' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items: OrderItemDto[];
}
