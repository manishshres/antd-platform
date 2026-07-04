import { IsString, IsOptional, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateOrganizationDto {
  @ApiPropertyOptional({
    example: 'Acme Restaurant Corp',
    description: 'The name of the organization',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @ApiPropertyOptional({
    example: 'api-key-123',
    description: 'Webhook API Key',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  webhookApiKey?: string;

  @ApiPropertyOptional({
    example: 'active',
    description: 'Organization status',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  status?: string;

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
