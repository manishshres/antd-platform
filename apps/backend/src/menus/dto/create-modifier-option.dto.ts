import { IsString, IsNotEmpty, IsInt, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateModifierOptionDto {
  @ApiProperty({ description: 'The name of the modifier option (e.g. Large)' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({
    description: 'The price adjustment in cents (e.g. 200 for $2.00)',
  })
  @IsInt()
  @Min(0)
  priceAdjustment: number;
}
