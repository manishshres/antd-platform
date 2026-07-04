import { IsNotEmpty, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AssignModifierDto {
  @ApiProperty({ description: 'The ID of the modifier group to assign' })
  @IsUUID()
  @IsNotEmpty()
  modifierId: string;
}
