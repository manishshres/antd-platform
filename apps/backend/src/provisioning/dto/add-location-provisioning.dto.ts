import { IsString, IsNotEmpty, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AddLocationProvisioningDto {
  @ApiProperty({ description: 'The name of the new location' })
  @IsString()
  @IsNotEmpty()
  locationName!: string;

  @ApiProperty({ description: 'Country code (e.g. US, CA)', default: 'US' })
  @IsString()
  @IsNotEmpty()
  country!: string;

  @ApiPropertyOptional({ description: 'State or Province' })
  @IsString()
  @IsOptional()
  state?: string;

  @ApiPropertyOptional({ description: 'City' })
  @IsString()
  @IsOptional()
  city?: string;
}
