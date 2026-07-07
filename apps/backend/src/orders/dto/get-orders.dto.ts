import {
  IsOptional,
  IsString,
  IsIn,
  MaxLength,
  IsDateString,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationDto } from '../../common/dto/pagination.dto';

const ORDER_STATUSES = [
  'pending',
  'preparing',
  'ready',
  'completed',
  'cancelled',
] as const;

export class GetOrdersDto extends PaginationDto {
  @ApiPropertyOptional({
    description: 'Filter by order status',
    enum: ORDER_STATUSES,
  })
  @IsOptional()
  @IsString()
  @IsIn(ORDER_STATUSES)
  status?: string;

  @ApiPropertyOptional({
    description: 'Search by ticket number (#47), customer name, or phone',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ description: 'Orders created on/after (ISO date)' })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional({ description: 'Orders created on/before (ISO date)' })
  @IsOptional()
  @IsDateString()
  dateTo?: string;
}
