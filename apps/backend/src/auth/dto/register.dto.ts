import {
  IsEmail,
  IsString,
  MinLength,
  IsNotEmpty,
  IsOptional,
  IsIn,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RegisterDto {
  @ApiProperty({
    example: 'user@example.com',
    description: 'The email address of the user',
  })
  @IsEmail({}, { message: 'Please enter a valid email address.' })
  @IsNotEmpty({ message: 'Email is required.' })
  email: string;

  @ApiProperty({
    example: 'password123',
    description: 'The password of the user (min 8 characters)',
  })
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters long.' })
  @IsNotEmpty({ message: 'Password is required.' })
  password: string;

  @ApiProperty({
    example: 'user',
    description:
      'The role of the user (only "user" and "manager" are allowed at registration; admin must be assigned manually)',
    required: false,
    enum: ['user', 'manager'],
  })
  @IsOptional()
  @IsString()
  @IsIn(['user', 'manager'], {
    message: 'Role must be either user or manager.',
  })
  role?: string;

  @ApiProperty({
    example: 'John',
    description: 'First name of the user',
  })
  @IsString()
  @IsNotEmpty({ message: 'First name is required.' })
  firstName: string;

  @ApiProperty({
    example: 'Doe',
    description: 'Last name of the user',
  })
  @IsString()
  @IsNotEmpty({ message: 'Last name is required.' })
  lastName: string;

  @ApiProperty({
    example: 'Acme Corp',
    description: 'Company name (which creates the organization)',
  })
  @IsString()
  @IsNotEmpty({ message: 'Company name is required.' })
  companyName: string;

  @ApiProperty({
    example: '+15551234567',
    description: 'Phone number of the user',
  })
  @IsString()
  @IsNotEmpty({ message: 'Phone number is required.' })
  phoneNumber: string;
}
