import { IsString, IsEmail, IsNotEmpty, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateInvitationDto {
  @ApiProperty()
  @IsEmail()
  @IsNotEmpty()
  email!: string;

  @ApiProperty({ description: 'Role to assign: sysadmin or manager' })
  @IsString()
  @IsNotEmpty()
  role!: string;

  @ApiPropertyOptional({ description: 'Location ID to assign manager to' })
  @IsString()
  @IsOptional()
  locationId?: string;
}
