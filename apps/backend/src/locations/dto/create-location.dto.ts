import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsObject,
  IsISO4217CurrencyCode,
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
    example: 'USD',
    default: 'USD',
    description:
      'ISO 4217 currency for this location. All money is stored as integer minor units; this records which currency those units are in (N8). Zero-decimal currencies (JPY, KRW) are not formatted correctly yet.',
  })
  @IsOptional()
  @IsISO4217CurrencyCode()
  currency?: string;

  @ApiPropertyOptional({
    example: 1800,
    description:
      'Optional auto-gratuity/service-charge rate in basis points (1800 = 18%). The POS offers it as a toggle at checkout; 0/unset means no service charge is offered.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  serviceChargeBps?: number;

  @ApiPropertyOptional({
    description:
      'Printing behavior: { kitchenEnabled, kitchenCopies, receiptEnabled, receiptCopies }',
  })
  @IsOptional()
  @IsObject()
  printSettings?: Record<string, unknown>;
}
