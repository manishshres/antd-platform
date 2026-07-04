import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsNotEmpty } from 'class-validator';

export class PrintOrderDto {
  @ApiPropertyOptional({
    example: 'kitchen-a',
    description:
      'Optional printer identifier for printer selection. Current implementation publishes to the organization standard print topics.',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  printerId?: string;
}
