import { IsString, Length, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SetPosPinDto {
  @ApiProperty({
    description: 'The new 6-digit POS PIN',
    example: '123456',
  })
  @IsString()
  @Length(6, 6)
  @Matches(/^[0-9]{6}$/, { message: 'PIN must be exactly 6 digits' })
  pin!: string;
}
