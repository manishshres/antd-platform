import { IsNotEmpty, IsString, IsOptional, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateCategoryDto {
  @ApiProperty({ example: 'Pizzas', description: 'The category name' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({
    description: 'Location ID to scope this category to',
    required: false,
  })
  @IsUUID()
  @IsOptional()
  locationId?: string;
}
