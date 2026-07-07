import { IsString, IsNumber, IsOptional, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateTableDto {
  @ApiProperty()
  @IsUUID()
  floorPlanId: string;

  @ApiProperty()
  @IsString()
  name: string;

  @ApiProperty({ required: false, default: 4 })
  @IsNumber()
  @IsOptional()
  capacity?: number;

  @ApiProperty({ required: false, default: 0 })
  @IsNumber()
  @IsOptional()
  posX?: number;

  @ApiProperty({ required: false, default: 0 })
  @IsNumber()
  @IsOptional()
  posY?: number;

  @ApiProperty({ required: false, default: 'rectangle' })
  @IsString()
  @IsOptional()
  shape?: string;
}
