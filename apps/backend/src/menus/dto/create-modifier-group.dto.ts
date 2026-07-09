import {
  IsString,
  IsNotEmpty,
  IsBoolean,
  IsOptional,
  IsUUID,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateModifierGroupDto {
  @ApiProperty({ description: 'The name of the modifier group (e.g. Size)' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({ description: 'Location ID to scope this modifier to' })
  @IsUUID()
  @IsOptional()
  locationId?: string;

  @ApiPropertyOptional({ description: 'Is this modifier group required?' })
  @IsBoolean()
  @IsOptional()
  isRequired?: boolean;

  @ApiPropertyOptional({
    description: 'Does this modifier group allow multiple selections?',
  })
  @IsBoolean()
  @IsOptional()
  multiSelect?: boolean;

  @ApiPropertyOptional({
    description: 'Maximum number of selections allowed if multiSelect is true',
  })
  @IsOptional()
  maxSelections?: number;
}
