import {
  IsString,
  IsNotEmpty,
  IsIn,
  IsOptional,
  MaxLength,
  Matches,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export type PrinterType = 'kitchen' | 'receipt' | 'label';

export class CreatePrinterDto {
  @ApiProperty({
    example: 'Main Kitchen Printer',
    description: 'Display name for the printer',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;

  @ApiProperty({
    example: 'restaurant/org123/kitchen/print',
    description: 'MQTT command topic this printer listens on',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  topic: string;

  @ApiProperty({
    example: 'kitchen',
    enum: ['kitchen', 'receipt', 'label'],
    description: 'Type of printer',
  })
  @IsIn(['kitchen', 'receipt', 'label'])
  type: PrinterType;

  @ApiProperty({
    example: '581527ad-3849-4deb-8099-ef8a02cfbd3a',
    description: 'Physical location ID of the printer',
  })
  @IsString()
  @IsNotEmpty()
  locationId: string;

  @ApiPropertyOptional({
    example: 'Main Kitchen',
    description: 'Physical location of the printer (name)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  locationName?: string;

  @ApiPropertyOptional({
    example: '192.168.1.50',
    description: 'IP address of the printer (optional)',
  })
  @IsOptional()
  @IsString()
  @Matches(/^(\d{1,3}\.){3}\d{1,3}$/, {
    message: 'ipAddress must be a valid IPv4 address',
  })
  ipAddress?: string;

  @ApiPropertyOptional({
    example: 'EPSON TM-T88VI',
    description: 'Printer hardware model',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  model?: string;

  @ApiPropertyOptional({
    example: 'Near the grill station',
    description: 'Additional notes',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
