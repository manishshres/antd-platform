import {
  IsEmail,
  IsString,
  MinLength,
  IsNotEmpty,
  IsOptional,
  IsIn,
  MaxLength,
  IsUUID,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateUserDto {
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
    enum: ['sysadmin', 'admin', 'user'],
    description: 'User role',
  })
  @IsString()
  @IsIn(['sysadmin', 'admin', 'user'], {
    message: 'Role must be a valid option.',
  })
  @IsNotEmpty()
  role: string;

  @ApiProperty({
    example: 'da0692d1-89fa-4386-8d95-9091f4eba0a0',
    description: 'Organization ID',
  })
  @IsUUID()
  @IsNotEmpty()
  organizationId: string;

  @ApiPropertyOptional({ example: 'John', description: 'First name' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  firstName?: string;

  @ApiPropertyOptional({ example: 'Doe', description: 'Last name' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  lastName?: string;

  @ApiPropertyOptional({ example: '+15551234567', description: 'Phone number' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  phoneNumber?: string;

  @ApiPropertyOptional({ example: 'Acme Corp', description: 'Company name' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  companyName?: string;
}
