import {
  IsNotEmpty,
  IsString,
  IsNumber,
  IsOptional,
  IsUUID,
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
}
