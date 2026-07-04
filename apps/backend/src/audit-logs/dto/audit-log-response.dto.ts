import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AuditLogResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  organizationId: string;

  @ApiPropertyOptional()
  userId?: string | null;

  @ApiPropertyOptional({ description: 'User email if available' })
  userEmail?: string | null;

  @ApiPropertyOptional({ description: 'User name if available' })
  userName?: string | null;

  @ApiProperty()
  action: string;

  @ApiPropertyOptional()
  entityType?: string | null;

  @ApiPropertyOptional()
  entityId?: string | null;

  @ApiPropertyOptional()
  previousValue?: unknown;

  @ApiPropertyOptional()
  newValue?: unknown;

  @ApiPropertyOptional()
  ipAddress?: string | null;

  @ApiPropertyOptional()
  userAgent?: string | null;

  @ApiProperty()
  createdAt: Date;
}
