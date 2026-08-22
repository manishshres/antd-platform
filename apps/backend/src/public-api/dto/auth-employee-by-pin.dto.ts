import { IsEmail, IsString, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AuthEmployeeByPinDto {
  @ApiProperty({
    description: 'Email of the employee (matches users.email)',
    example: 'alice@coneeko.test',
  })
  @IsEmail()
  email!: string;

  @ApiProperty({
    description: '6-digit numeric PIN',
    example: '123456',
  })
  @IsString()
  @Matches(/^[0-9]{6}$/, { message: 'PIN must be exactly 6 digits' })
  pin!: string;
}

export class VerifyManagerPinDto {
  @ApiProperty({
    description: '6-digit numeric PIN of the acting manager',
    example: '123456',
  })
  @IsString()
  @Matches(/^[0-9]{6}$/, { message: 'PIN must be exactly 6 digits' })
  pin!: string;

  @ApiProperty({
    description:
      'Optional employeeId whose PIN matched previously, used to short-circuit bcrypt search',
    required: false,
  })
  @IsString()
  candidateEmployeeId?: string;
}
