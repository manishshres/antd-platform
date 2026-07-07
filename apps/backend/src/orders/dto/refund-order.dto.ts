import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length, Matches, IsOptional } from 'class-validator';

export class RefundOrderDto {
  @ApiProperty({
    description: 'The 4-digit manager PIN to authorize the refund/void.',
    example: '1234',
  })
  @IsString()
  @Length(4, 4)
  @Matches(/^[0-9]{4}$/, { message: 'PIN must be exactly 4 digits' })
  managerPin!: string;

  @ApiProperty({
    description: 'Optional reason for the refund or void',
    required: false,
  })
  @IsOptional()
  @IsString()
  reason?: string;
}
