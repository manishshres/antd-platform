import {
  IsString,
  IsIn,
  IsOptional,
  MaxLength,
  Matches,
  IsNotEmpty,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdatePrinterDto {
  @ApiPropertyOptional({ example: 'Receipt Counter Printer' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name?: string;

  @ApiPropertyOptional({ example: 'restaurant/org123/receipt/print' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  topic?: string;

  @ApiPropertyOptional({ enum: ['kitchen', 'receipt', 'label'] })
  @IsOptional()
  @IsIn(['kitchen', 'receipt', 'label'])
  type?: 'kitchen' | 'receipt' | 'label';

  @ApiPropertyOptional({ example: '581527ad-3849-4deb-8099-ef8a02cfbd3a' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  locationId?: string;

  @ApiPropertyOptional({ example: 'Counter Area' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  locationName?: string;

  @ApiPropertyOptional({ example: '192.168.1.51' })
  @IsOptional()
  @IsString()
  @Matches(/^(\d{1,3}\.){3}\d{1,3}$/, {
    message: 'ipAddress must be a valid IPv4 address',
  })
  ipAddress?: string;

  @ApiPropertyOptional({ example: 'Star TSP143III' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  model?: string;

  @ApiPropertyOptional({ example: 'Main cashier counter' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
