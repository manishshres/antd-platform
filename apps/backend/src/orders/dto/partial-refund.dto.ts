import { ApiProperty } from '@nestjs/swagger';
import {
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Min,
} from 'class-validator';

export class PartialRefundDto {
  @ApiProperty({
    description: 'The 6-digit manager PIN to authorize the refund.',
    example: '123456',
  })
  @IsString()
  @Length(4, 4)
  @Matches(/^[0-9]{6}$/, { message: 'PIN must be exactly 6 digits' })
  managerPin!: string;

  @ApiProperty({
    description: 'The amount to refund in cents.',
    example: 500,
  })
  @IsInt()
  @Min(1)
  amount!: number;

  @ApiProperty({
    description: 'Optional reason for the refund.',
    required: false,
  })
  @IsOptional()
  @IsString()
  reason?: string;
}
