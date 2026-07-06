import { IsIn, IsInt, IsOptional, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RecordPaymentDto {
  @ApiProperty({ example: 'cash', enum: ['cash', 'card'] })
  @IsIn(['cash', 'card'])
  method: string;

  @ApiProperty({
    required: false,
    description: 'Cents to apply; omit to pay the full remaining balance',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  amount?: number;

  @ApiProperty({
    required: false,
    description: 'Cash only: cents handed over (change is computed and stored)',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  cashReceived?: number;

  @ApiProperty({
    required: false,
    description: 'Tip in cents carried by this payment (added to the total)',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  tipAmount?: number;
}
