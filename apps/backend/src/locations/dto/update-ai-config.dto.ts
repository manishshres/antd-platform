import { IsObject, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateAiConfigDto {
  @ApiProperty({
    description: 'Dynamic variables for the location AI',
    required: false,
  })
  @IsObject()
  @IsOptional()
  aiSettings?: Record<string, any>;
}
