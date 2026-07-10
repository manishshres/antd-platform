import { IsIn, IsOptional, IsString, IsDateString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const GRANULARITIES = ['day', 'week', 'month'] as const;
export type ReportGranularity = (typeof GRANULARITIES)[number];

export class OrderReportDto {
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

  @ApiPropertyOptional({
    description: 'Bucket size for the time series',
    enum: GRANULARITIES,
    default: 'day',
  })
  @IsOptional()
  @IsIn(GRANULARITIES)
  granularity?: ReportGranularity;
}

export class PrintOrderReportDto extends OrderReportDto {
  @ApiPropertyOptional({
    description:
      'Target printer id/topic. Omitted = the location/org default receipt printer.',
  })
  @IsOptional()
  @IsString()
  printerId?: string;
}
