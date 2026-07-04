import {
  Controller,
  Get,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../common/decorators/current-user.decorator';
import { AuditLogsService } from './audit-logs.service';
import { AuditLogsQueryDto } from './dto/audit-logs-query.dto';
import { AuditLogResponseDto } from './dto/audit-log-response.dto';
import { PaginatedResponseDto } from '../common/dto/paginated-response.dto';

@ApiTags('Audit Logs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('audit-logs')
export class AuditLogsController {
  constructor(private readonly auditLogsService: AuditLogsService) {}

  @Get()
  @Roles('sysadmin') // Only sysadmin and platform_admin can view audit logs
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List organization audit logs' })
  @ApiResponse({
    status: 200,
    description: 'Returns paginated audit logs.',
    type: PaginatedResponseDto,
  })
  async listAuditLogs(
    @CurrentUser() user: CurrentUserPayload,
    @Query() query: AuditLogsQueryDto,
  ): Promise<PaginatedResponseDto<AuditLogResponseDto>> {
    if (!user.organizationId) {
      throw new BadRequestException('User does not belong to an organization.');
    }
    return (await this.auditLogsService.listAuditLogs(
      user.organizationId,
      query,
    )) as unknown as PaginatedResponseDto<AuditLogResponseDto>;
  }
}
