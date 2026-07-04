import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class VerifyEmailDto {
  @ApiProperty({
    description: 'The email verification token from the verification email',
    example: 'b7e2a1c4d9f8...',
  })
  @IsString()
  @IsNotEmpty()
  token: string;
}
