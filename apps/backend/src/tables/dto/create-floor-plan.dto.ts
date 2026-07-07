import { IsString, IsNumber, IsOptional, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateFloorPlanDto {
  @ApiProperty()
  @IsUUID()
  locationId: string;

  @ApiProperty()
  @IsString()
  name: string;

  @ApiProperty({ required: false, default: 1000 })
  @IsNumber()
  @IsOptional()
  width?: number;

  @ApiProperty({ required: false, default: 1000 })
  @IsNumber()
  @IsOptional()
  height?: number;
}
