import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateDiscountDto {
  @ApiProperty({ example: 'Lunch Special 10%' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;

  @ApiPropertyOptional({
    example: 'LUNCH10',
    description: 'Optional promo code; null = button-only discount',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  code?: string;

  @ApiProperty({ enum: ['percent', 'fixed'] })
  @IsIn(['percent', 'fixed'])
  type: string;

  @ApiProperty({
    example: 10,
    description: 'percent: whole percent (0-100); fixed: cents off subtotal',
  })
  @IsInt()
  @Min(0)
  @Max(1000000)
  value: number;

  @ApiPropertyOptional({ description: 'Only managers/admins may apply it' })
  @IsOptional()
  @IsBoolean()
  requiresManager?: boolean;

  @ApiPropertyOptional({ description: 'Scope to a single location' })
  @IsOptional()
  @IsUUID()
  locationId?: string;
}
