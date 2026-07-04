import { IsObject } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateFeatureFlagsDto {
  @ApiProperty({
    description: 'Key-value pairs of feature flags',
    example: { customBranding: true },
  })
  @IsObject()
  flags!: Record<string, boolean>;
}
