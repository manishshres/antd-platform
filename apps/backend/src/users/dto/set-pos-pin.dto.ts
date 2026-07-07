import { IsString, Length, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SetPosPinDto {
  @ApiProperty({
    description: 'The new 4-digit POS PIN',
    example: '1234',
  })
  @IsString()
  @Length(4, 4)
  @Matches(/^[0-9]{4}$/, { message: 'PIN must be exactly 4 digits' })
  pin!: string;
}
