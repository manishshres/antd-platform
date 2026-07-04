import { IsString, IsNotEmpty, IsEmail, IsOptional, IsObject } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateOrgProvisionDto {
  @ApiProperty({ description: 'The name of the organization/company' })
  @IsString()
  @IsNotEmpty()
  orgName!: string;

  @ApiProperty({ description: 'The email address for the organization admin' })
  @IsEmail()
  @IsNotEmpty()
  adminEmail!: string;

  @ApiProperty({ description: 'The name of the first location' })
  @IsString()
  @IsNotEmpty()
  locationName!: string;

  @ApiProperty({ description: 'Country code (e.g. US, CA)', default: 'US' })
  @IsString()
  @IsNotEmpty()
  country!: string;

  @ApiPropertyOptional({ description: 'State or Province' })
  @IsString()
  @IsOptional()
  state?: string;

  @ApiPropertyOptional({ description: 'City' })
  @IsString()
  @IsOptional()
  city?: string;

  @ApiPropertyOptional({ description: 'Phone number to claim' })
  @IsString()
  @IsOptional()
  phoneNumber?: string;

  @ApiPropertyOptional({ description: 'The Telnyx Voice AI Agent ID to clone from' })
  @IsString()
  @IsOptional()
  baseAgentId?: string;

  @ApiPropertyOptional({ description: 'Dynamic variables for the AI Agent' })
  @IsObject()
  @IsOptional()
  dynamicVariables?: Record<string, string>;

  @ApiPropertyOptional({ description: 'Menu URL to scrape' })
  @IsString()
  @IsOptional()
  menuUrl?: string;
}
