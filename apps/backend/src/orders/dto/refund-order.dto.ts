import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length, Matches, IsOptional } from 'class-validator';

export class RefundOrderDto {
  @ApiProperty({
    description: 'The 6-digit manager PIN to authorize the refund/void.',
    example: '123456',
  })
  @IsString()
  @Length(6, 6)
  @Matches(/^[0-9]{6}$/, { message: 'PIN must be exactly 6 digits' })
  managerPin!: string;

  @ApiProperty({
    description: 'Optional reason for the refund or void',
    required: false,
  })
  @IsOptional()
  @IsString()
  reason?: string;
}
