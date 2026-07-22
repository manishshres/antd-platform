import { IsOptional, IsString, IsNumber, IsBoolean } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateItemDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  price?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  categoryId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  imageUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isAvailable?: boolean;

  @ApiPropertyOptional({ description: 'Pin to the POS Favorites strip' })
  @IsOptional()
  @IsBoolean()
  isFavorite?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  sortOrder?: number;

  @ApiPropertyOptional()
  @IsOptional()
  availabilitySchedule?: unknown;

  @ApiPropertyOptional({ description: 'Barcode/SKU for POS retail scanning' })
  @IsOptional()
  @IsString()
  sku?: string;

  @ApiPropertyOptional({
    description:
      'Marks this item as a combo/bundle — its required modifier groups are its combo components',
  })
  @IsOptional()
  @IsBoolean()
  isCombo?: boolean;

  @ApiPropertyOptional({ description: 'Excludes this item from tax calculation' })
  @IsOptional()
  @IsBoolean()
  taxExempt?: boolean;

  @ApiPropertyOptional({
    description: 'Stock on hand; leave unset for items that are not stock-tracked',
  })
  @IsOptional()
  @IsNumber()
  stockQuantity?: number;

  @ApiPropertyOptional({
    description: 'Quantity at or below which the POS flags this item as low stock',
  })
  @IsOptional()
  @IsNumber()
  lowStockThreshold?: number;
}
