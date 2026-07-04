import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateApiKeyDto {
  @ApiProperty({
    description: 'A descriptive name for this API key',
    example: 'Doordash Integration',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;
}
