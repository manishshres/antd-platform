import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateStatusDto {
  @ApiProperty({
    example: 'preparing',
    description:
      'The new order status: pending, preparing, ready, completed, cancelled',
  })
  @IsString()
  @IsNotEmpty()
  status: string;
}
