import { IsEmail, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AssignManagerDto {
  @ApiProperty({ description: 'The email of the manager to assign/invite' })
  @IsEmail()
  @IsNotEmpty()
  email!: string;
}
