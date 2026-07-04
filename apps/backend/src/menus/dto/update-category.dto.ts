import { IsString, IsOptional, IsBoolean } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateCategoryDto {
  @ApiProperty({ description: 'The category name', required: false })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiProperty({
    description: 'Whether the category is available for ordering',
    required: false,
  })
  @IsBoolean()
  @IsOptional()
  isAvailable?: boolean;
}
