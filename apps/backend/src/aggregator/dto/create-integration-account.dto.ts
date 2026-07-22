import {
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

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

  @ApiProperty({
    description:
      'Provider credentials (encrypted at rest). For KitchenHub: { clientId, clientSecret, webhookSecret?, storeId? }.',
    type: 'object',
    additionalProperties: true,
  })
  @IsObject()
  credentials!: Record<string, unknown>;
}
