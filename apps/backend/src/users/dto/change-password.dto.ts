import { IsString, MinLength, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ChangePasswordDto {
  @ApiProperty({ example: 'OldPass123!', description: 'Current password' })
  @IsString()
  currentPassword: string;

  @ApiProperty({
    example: 'NewPass456!',
    description: 'New password (min 8 chars)',
  })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  newPassword: string;
}
