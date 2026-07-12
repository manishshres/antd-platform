import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type, Transform } from 'class-transformer';
import {
  IsInt,
  Min,
  Max,
  IsOptional,
  IsBoolean,
  IsUUID,
} from 'class-validator';

export class PaginationDto {
  @ApiPropertyOptional({
    description: 'Number of records to skip',
    default: 0,
    minimum: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number = 0;

  @ApiPropertyOptional({
    description: 'Whether to include soft-deleted items in the result',
    default: false,
  })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  showDeleted?: boolean = false;

  @ApiPropertyOptional({
    description: 'Maximum number of records to return',
    default: 20,
    minimum: 1,
    maximum: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({ description: 'Filter by location ID' })
  @IsOptional()
  @Type(() => String)
  locationId?: string;

  // Consumed by JwtStrategy as the platform-admin tenant override before the
  // handler runs; declared here only so forbidNonWhitelisted doesn't reject it.
  // Handlers must keep using user.organizationId, never this field.
  @ApiPropertyOptional({
    description:
      'Platform admins only: operate within this organization. Ignored for all other roles.',
  })
  @IsOptional()
  @IsUUID()
  orgId?: string;
}
