import {
  IsBoolean,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateIntegrationAccountDto {
  @ApiProperty({
    example: 'kitchenhub',
    description: 'Registered provider name.',
  })
  @IsString()
  @MaxLength(255)
  providerName!: string;

  @ApiProperty({ required: false, description: 'Optional location scope.' })
  @IsOptional()
  @IsUUID()
  locationId?: string;

  @ApiProperty({
    required: false,
    description: 'The provider-side store id this account maps to.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  providerStoreId?: string;

  @ApiPropertyOptional({
    description:
      'Auto-accept inbound marketplace orders on the provider (default true). When false, ' +
      'orders land pending for manual accept/deny from the POS/dashboard.',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  autoAcceptOrders?: boolean;

  @ApiProperty({
    description:
      'Provider credentials (encrypted at rest). For KitchenHub: { clientId, clientSecret, webhookSecret?, storeId? }. For Uber Eats: { clientId, clientSecret, storeId }.',
    type: 'object',
    additionalProperties: true,
  })
  @IsObject()
  credentials!: Record<string, unknown>;
}

/**
 * Mutable settings on an existing integration account. Deliberately narrow — the provider
 * and org binding never change here; reconnecting is a separate create. Only operational
 * toggles live on PATCH.
 */
export class UpdateIntegrationAccountDto {
  @ApiPropertyOptional({
    description: 'Flip auto-accept of inbound marketplace orders.',
  })
  @IsOptional()
  @IsBoolean()
  autoAcceptOrders?: boolean;

  @ApiPropertyOptional({
    description: 'The provider-side store id this account maps to.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  providerStoreId?: string;

  @ApiPropertyOptional({
    description:
      'Replace the stored credentials (re-encrypted at rest). Omit to leave the ' +
      'existing credentials untouched — this is a full replacement, not a merge.',
    type: 'object',
    additionalProperties: true,
  })
  @IsOptional()
  @IsObject()
  credentials?: Record<string, unknown>;
}
