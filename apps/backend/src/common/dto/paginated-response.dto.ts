import { ApiProperty } from '@nestjs/swagger';

export class PaginatedResponseDto<T> {
  @ApiProperty({ description: 'Array of data records', isArray: true })
  data: T[];

  @ApiProperty({
    description: 'Total number of records available matching the criteria',
  })
  total: number;

  @ApiProperty({
    description: 'Indicates if there are more records beyond the current page',
  })
  hasMore: boolean;
}
