import { IsDateString, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class GetOrderSummaryDto {
  @ApiProperty({ description: 'Location to report on' })
  @IsString()
  locationId!: string;

  @ApiPropertyOptional({ description: 'Range start (ISO date), default today' })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional({ description: 'Range end (ISO date), default today' })
  @IsOptional()
  @IsDateString()
  dateTo?: string;
}
