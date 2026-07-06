import { IsIn, IsNumber, IsOptional, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class PayOrderDto {
  @ApiProperty({
    example: 'cash',
    description: 'How the order was paid (detailed processing comes later)',
  })
  @IsIn(['cash', 'card'])
  paymentMethod: string;

  @ApiProperty({ required: false, description: 'Tip in cents' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  tipAmount?: number;
}
