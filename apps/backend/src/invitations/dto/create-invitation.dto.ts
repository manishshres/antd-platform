import {
  IsString,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsIn,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { INVITABLE_ROLES } from '../../common/constants/roles';

// Canonical definition lives in common/constants/roles; re-exported for existing importers (M4).
export { INVITABLE_ROLES };

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
