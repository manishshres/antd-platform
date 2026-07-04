import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ProvisioningStepDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  stepName!: string;

  @ApiProperty()
  stepOrder!: number;

  @ApiProperty()
  status!: string;

  @ApiProperty()
  attempts!: number;

  @ApiPropertyOptional()
  lastError?: string;

  @ApiPropertyOptional()
  startedAt?: Date | null;

  @ApiPropertyOptional()
  completedAt?: Date | null;
}

export class ProvisioningStatusResponseDto {
  @ApiProperty()
  organizationId!: string;

  @ApiProperty()
  locationId!: string;

  @ApiProperty()
  organizationStatus!: string;

  @ApiProperty()
  locationStatus!: string;

  @ApiPropertyOptional()
  provisioningError?: string;

  @ApiProperty({ type: [ProvisioningStepDto] })
  steps!: ProvisioningStepDto[];
}
