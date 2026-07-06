import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsObject,
  MaxLength,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateLocationDto {
  @ApiProperty({ example: 'Downtown Branch' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;

  @ApiPropertyOptional({ example: '123 Main St' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;

  @ApiPropertyOptional({ example: 'New York' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  city?: string;

  @ApiPropertyOptional({ example: 'NY' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  state?: string;

  @ApiPropertyOptional({ example: 'US' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  country?: string;

  @ApiPropertyOptional({ example: '10001' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  postalCode?: string;

  @ApiPropertyOptional({ example: 'America/New_York' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  timezone?: string;

  @ApiPropertyOptional({ example: 'https://example.com/menu' })
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  menuImportSource?: string;

  @ApiPropertyOptional({
    example: 825,
    description: 'Sales tax rate in basis points (825 = 8.25%)',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  taxRateBps?: number;

  @ApiPropertyOptional({
    description:
      'Printing behavior: { kitchenEnabled, kitchenCopies, receiptEnabled, receiptCopies }',
  })
  @IsOptional()
  @IsObject()
  printSettings?: Record<string, unknown>;
}
