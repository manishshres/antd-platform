import { ApiProperty } from '@nestjs/swagger';
import { IsUrl, IsNotEmpty, IsOptional, IsUUID } from 'class-validator';

export class ImportMenuDto {
  @ApiProperty({
    description: 'The URL of the restaurant website to scrape and import',
    example: 'https://pizza-palace-example.com/menu',
    required: false,
  })
  @IsOptional()
  @IsUrl({}, { message: 'Please provide a valid website URL.' })
  url?: string;

  @ApiProperty({
    description: 'Import mode: add_new, sync, or replace',
    example: 'sync',
    required: false,
  })
  @IsOptional()
  importMode?: 'add_new' | 'sync' | 'replace';

  @ApiProperty({
    description: 'Organization ID to import this menu for (Platform Admins only)',
    required: false,
  })
  @IsUUID()
  @IsOptional()
  orgId?: string;

  @ApiProperty({
    description: 'Location ID to import this menu for',
    required: false,
  })
  @IsUUID()
  @IsOptional()
  locationId?: string;
}
