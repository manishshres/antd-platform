import {
  IsEmail,
  IsString,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({
    example: 'user@example.com',
    description: 'The email address of the user',
  })
  @IsEmail({}, { message: 'Please enter a valid email address.' })
  @IsNotEmpty({ message: 'Email is required.' })
  email: string;

  @ApiProperty({
    example: 'password123',
    description: 'The password of the user',
  })
  @IsString()
  @IsNotEmpty({ message: 'Password is required.' })
  password: string;

  @ApiPropertyOptional({
    example: true,
    description:
      'If true, refresh token TTL is extended to 30 days (default: 7 days)',
  })
  @IsOptional()
  @IsBoolean()
  rememberMe?: boolean;
}
