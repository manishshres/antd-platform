import {
  IsNotEmpty,
  IsString,
  IsNumber,
  IsOptional,
  IsUUID,
  IsBoolean,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateItemDto {
  @ApiProperty({
    example: 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d',
    description: 'The category UUID',
  })
  @IsUUID()
  @IsNotEmpty()
  categoryId: string;

  @ApiProperty({
    example: 'Margherita Pizza',
    description: 'Name of the menu item',
  })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({
    example: 'Classic cheese and tomato pizza',
    description: 'Description of the item',
  })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({
    example: 1299,
    description: 'Price in cents (e.g. 1299 = $12.99)',
  })
  @IsNumber()
  @IsNotEmpty()
  price: number;

  @ApiProperty({
    example: 'https://example.com/pizza.jpg',
    description: 'Image URL for the item',
  })
  @IsString()
  @IsOptional()
  imageUrl?: string;

  @ApiProperty({
    description: 'Location ID to scope this item to',
    required: false,
  })
  @IsUUID()
  @IsOptional()
  locationId?: string;

  @ApiProperty({
    description: 'Barcode/SKU for POS retail scanning',
    required: false,
  })
  @IsString()
  @IsOptional()
  sku?: string;

  @ApiProperty({
    description:
      'Marks this item as a combo/bundle — its required modifier groups are its combo components',
    required: false,
  })
  @IsBoolean()
  @IsOptional()
  isCombo?: boolean;

  @ApiProperty({
    description: 'Excludes this item from tax calculation',
    required: false,
  })
  @IsBoolean()
  @IsOptional()
  taxExempt?: boolean;

  @ApiProperty({
    description: 'Stock on hand; leave unset for items that are not stock-tracked',
    required: false,
  })
  @IsNumber()
  @IsOptional()
  stockQuantity?: number;

  @ApiProperty({
    description: 'Quantity at or below which the POS flags this item as low stock',
    required: false,
  })
  @IsNumber()
  @IsOptional()
  lowStockThreshold?: number;
}
