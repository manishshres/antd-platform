import { IsIn, IsNumber, IsOptional, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { PAYMENT_METHODS } from '../payment-methods';

export class PayOrderDto {
  @ApiProperty({
    example: 'cash',
    description: 'How the order was paid (detailed processing comes later)',
    enum: PAYMENT_METHODS,
  })
  @IsIn(PAYMENT_METHODS)
  paymentMethod: string;

  @ApiProperty({ required: false, description: 'Tip in cents' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  tipAmount?: number;
}
