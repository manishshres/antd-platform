import {
  IsString,
  IsUrl,
  IsArray,
  IsNotEmpty,
  IsBoolean,
  IsOptional,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateOrgWebhookDto {
  @ApiProperty({ example: 'https://my-system.com/api/webhooks' })
  @IsUrl()
  @IsNotEmpty()
  url!: string;

  @ApiProperty({ example: ['order.created', 'order.updated'] })
  @IsArray()
  @IsString({ each: true })
  @IsNotEmpty()
  events!: string[];

  @ApiProperty({ example: true, required: false })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
