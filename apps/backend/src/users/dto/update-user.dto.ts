import {
  IsString,
  IsOptional,
  MaxLength,
  MinLength,
  IsIn,
  IsEmail,
  IsUUID,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateUserDto {
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

  @ApiPropertyOptional({
    example: 'admin',
    enum: ['sysadmin', 'admin', 'user'],
    description: 'User role in the organization',
  })
  @IsOptional()
  @IsString()
  @IsIn(['sysadmin', 'admin', 'user'])
  role?: string;

  @ApiPropertyOptional({
    example: 'new-email@example.com',
    description: 'Email address',
  })
  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  email?: string;

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

  @ApiPropertyOptional({
    example: 'NewPass123!',
    description: 'New password (leave blank to keep current)',
  })
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password?: string;
}

export class UpdateUserGlobalDto extends UpdateUserDto {
  @ApiPropertyOptional({
    example: 'uuid-here',
    description: 'Organization ID to assign the user to',
  })
  @IsOptional()
  @IsUUID()
  organizationId?: string;
}
