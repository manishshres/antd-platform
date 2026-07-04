import {
  IsEmail,
  IsString,
  MinLength,
  IsNotEmpty,
  IsOptional,
  IsIn,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateTeamMemberDto {
  @ApiProperty({
    example: 'member@example.com',
    description: 'The email address of the team member',
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
    enum: ['admin', 'user'],
    description: 'User role',
  })
  @IsString()
  @IsIn(['admin', 'user'], {
    message: 'Role must be admin or user.',
  })
  @IsNotEmpty()
  role: string;

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
