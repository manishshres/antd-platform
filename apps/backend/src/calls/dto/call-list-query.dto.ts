import { PaginationDto } from '../../common/dto/pagination.dto';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class CallListQueryDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Search term for transcript filtering' })
  @IsOptional()
  @IsString()
  search?: string;
}
