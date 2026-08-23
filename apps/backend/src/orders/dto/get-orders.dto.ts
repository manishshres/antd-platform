import {
  IsOptional,
  IsString,
  IsIn,
  MaxLength,
  IsDateString,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationDto } from '../../common/dto/pagination.dto';

// Must mirror the orders_status_check constraint in schema.ts. 'confirmed' and 'refunded'
// were missing, so a filter on either 400'd — and paying a pending order moves it to
// 'confirmed', which made every paid-but-unfinished order impossible to list by status.
const ORDER_STATUSES = [
  'pending',
  'confirmed',
  'preparing',
  'ready',
  'completed',
  'cancelled',
  'refunded',
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
