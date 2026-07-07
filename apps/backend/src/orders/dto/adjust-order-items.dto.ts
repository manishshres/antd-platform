import {
  IsArray,
  IsOptional,
  IsString,
  Length,
  Matches,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { PosOrderItemDto } from './create-pos-order.dto';

export class AdjustOrderItemsDto {
  @ApiProperty({
    description: 'The 4-digit manager PIN to authorize the adjustment.',
    example: '1234',
  })
  @IsString()
  @Length(4, 4)
  @Matches(/^[0-9]{4}$/, { message: 'PIN must be exactly 4 digits' })
  managerPin!: string;

  @ApiProperty({ type: [PosOrderItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PosOrderItemDto)
  items: PosOrderItemDto[];

  @ApiProperty({
    description: 'Optional reason for the adjustment.',
    required: false,
  })
  @IsOptional()
  @IsString()
  reason?: string;
}
