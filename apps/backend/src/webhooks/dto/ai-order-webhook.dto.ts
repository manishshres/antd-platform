import { ApiProperty } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsString,
  IsArray,
  ValidateNested,
  IsInt,
  Min,
  IsOptional,
} from 'class-validator';
import { Type } from 'class-transformer';

export class WebhookOrderItemDto {
  @ApiProperty({
    example: 'd0ad21bb-452f-488f-9a4f-561bcf7bf812',
    description:
      'Database UUID of the menu item (optional if name is provided)',
    required: false,
  })
  @IsOptional()
  @IsString()
  menuItemId?: string;

  @ApiProperty({
    example: 'Margherita Pizza',
    description: 'Name of the menu item (optional if menuItemId is provided)',
    required: false,
  })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({ example: 2, description: 'Quantity of the item' })
  @IsInt()
  @Min(1)
  quantity: number;
}

export class AiOrderWebhookDto {
  @ApiProperty({ example: 'John Doe', description: 'Customer Name' })
  @IsString()
  @IsNotEmpty()
  customerName: string;

  @ApiProperty({ example: '+1234567890', description: 'Customer Phone Number' })
  @IsString()
  @IsNotEmpty()
  customerPhone: string;

  @ApiProperty({
    type: [WebhookOrderItemDto],
    description: 'List of ordered items',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WebhookOrderItemDto)
  items: WebhookOrderItemDto[];
}
