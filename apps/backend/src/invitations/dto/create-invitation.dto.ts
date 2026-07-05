import {
  IsString,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsIn,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Roles that may be granted via an org invitation — never platform_admin (M4). */
export const INVITABLE_ROLES = ['manager', 'admin', 'sysadmin'] as const;

export class CreateInvitationDto {
  @ApiProperty()
  @IsEmail()
  @IsNotEmpty()
  email!: string;

  @ApiProperty({ description: 'Role to assign', enum: INVITABLE_ROLES })
  @IsString()
  @IsNotEmpty()
  @IsIn(INVITABLE_ROLES)
  role!: string;

  @ApiPropertyOptional({ description: 'Location ID to assign manager to' })
  @IsString()
  @IsOptional()
  locationId?: string;
}
