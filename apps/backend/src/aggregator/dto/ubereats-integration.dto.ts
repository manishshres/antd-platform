import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Body for enabling the Uber Eats POS integration on an already-associated store. The
 * store id, credentials and our own identifiers all come from the integration account —
 * the only thing a caller can add is the merchant's own store number, which Uber shows
 * to support staff.
 */
export class EnableUberIntegrationDto {
  @ApiPropertyOptional({
    description:
      'The merchant’s own store number, surfaced in Uber Eats Manager.',
    example: 'Market-01',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  merchantStoreId?: string;
}

/** Body for kicking off the merchant OAuth handshake. */
export class StartUberOnboardingDto {
  @ApiPropertyOptional({
    description:
      'Coneeko location to bind the provisioned store(s) to. Can also be chosen ' +
      'per store at activation time.',
  })
  @IsOptional()
  @IsUUID()
  locationId?: string;
}

export class ActivateUberStoreDto {
  @ApiProperty({
    description:
      'Uber store UUID, which must be one of the stores returned by this session.',
  })
  @IsString()
  @MaxLength(255)
  storeId!: string;

  @ApiPropertyOptional({ description: 'Coneeko location for this store.' })
  @IsOptional()
  @IsUUID()
  locationId?: string;

  @ApiPropertyOptional({
    description:
      'The merchant’s own store number, surfaced in Uber Eats Manager.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  merchantStoreId?: string;
}

/** The stores the merchant picked out of the ones their authorization exposed. */
export class ActivateUberStoresDto {
  @ApiProperty({ type: [ActivateUberStoreDto] })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ActivateUberStoreDto)
  stores!: ActivateUberStoreDto[];
}
