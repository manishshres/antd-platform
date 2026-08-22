import {
  IsString,
  IsNotEmpty,
  IsEmail,
  IsOptional,
  IsObject,
  IsBoolean,
} from 'class-validator';
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

  @ApiPropertyOptional({
    description: 'The Telnyx Voice AI Agent ID to clone from',
  })
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

  /**
   * Reuse the number already attached to `baseAgentId` instead of buying a new one.
   * Skips the search/purchase steps entirely — every purchase is billable, so this is
   * how repeated provisioning runs (testing, demos) avoid a per-run carrier charge.
   * A number can only back one location at a time; provisioning is rejected if the
   * agent's number is already claimed.
   */
  @ApiPropertyOptional({
    description: "Reuse the selected agent's existing phone number",
    default: false,
  })
  @IsBoolean()
  @IsOptional()
  useAgentPhoneNumber?: boolean;
}
