import { IsString, IsNotEmpty, IsOptional, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateOrganizationDto {
  @ApiProperty({
    example: 'Acme Restaurant Corp',
    description: 'The name of the organization',
  })
  @IsString()
  @IsNotEmpty({ message: 'Organization name is required.' })
  @MaxLength(255)
  name: string;

  @ApiPropertyOptional({
    example: 'api-key-123',
    description: 'Webhook API Key',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  webhookApiKey?: string;

  @ApiPropertyOptional({ example: 'printer-01', description: 'Printer ID' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  printerId?: string;

  @ApiPropertyOptional({
    example: 'restaurant/1/kitchen/print',
    description: 'Printer Topic',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  printerTopic?: string;

  @ApiPropertyOptional({
    example: 'Kitchen Printer',
    description: 'Printer Name',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  printerName?: string;

  @ApiPropertyOptional({
    example: 'assistant-123',
    description: 'Voice AI Assistant ID',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  assistantId?: string;

  @ApiPropertyOptional({
    example: 'https://example.com/logo.png',
    description: 'Logo URL',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  brandingLogoUrl?: string;

  @ApiPropertyOptional({
    example: '#1677ff',
    description: 'Branding Primary Color',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  brandingColor?: string;
}
