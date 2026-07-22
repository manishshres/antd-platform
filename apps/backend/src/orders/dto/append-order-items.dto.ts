import {
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { PosOrderItemDto } from './create-pos-order.dto';

/**
 * Items to ADD to an open tab — a delta, not a replacement. Two registers
 * ringing into the same tab each send only their own lines, so neither can
 * drop the other's; see OrdersService.appendOrderItems.
 */
export class AppendOrderItemsDto {
  @ApiProperty({ type: [PosOrderItemDto], description: 'Items to add' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PosOrderItemDto)
  items: PosOrderItemDto[];

  @ApiProperty({
    required: false,
    description:
      'Idempotency key minted on-device. Replaying it after a dropped ' +
      'response is a no-op rather than a double-append.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  clientMutationId?: string;
}
