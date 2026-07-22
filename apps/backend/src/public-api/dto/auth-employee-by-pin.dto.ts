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
    description: '4-digit numeric PIN',
    example: '1234',
  })
  @IsString()
  @Matches(/^[0-9]{4}$/, { message: 'PIN must be exactly 4 digits' })
  pin!: string;
}

export class VerifyManagerPinDto {
  @ApiProperty({
    description: '4-digit numeric PIN of the acting manager',
    example: '1234',
  })
  @IsString()
  @Matches(/^[0-9]{4}$/, { message: 'PIN must be exactly 4 digits' })
  pin!: string;

  @ApiProperty({
    description:
      'Optional employeeId whose PIN matched previously, used to short-circuit bcrypt search',
    required: false,
  })
  @IsString()
  candidateEmployeeId?: string;
}
