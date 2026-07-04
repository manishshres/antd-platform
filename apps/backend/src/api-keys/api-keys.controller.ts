import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
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
import { ApiKeysService } from './api-keys.service';
import { CreateApiKeyDto } from './dto/create-api-key.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../common/decorators/current-user.decorator';

@ApiTags('API Keys')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api-keys')
export class ApiKeysController {
  constructor(private readonly apiKeysService: ApiKeysService) {}

  @Post()
  @Roles('sysadmin')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Generate a new API key' })
  @ApiResponse({
    status: 201,
    description: 'API Key created. The raw key is only returned this one time.',
  })
  async createApiKey(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: CreateApiKeyDto,
  ) {
    return this.apiKeysService.generateApiKey(user, dto.name);
  }

  @Get()
  @Roles('sysadmin', 'manager')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List all API keys for the organization' })
  @ApiResponse({
    status: 200,
    description: 'Returns list of API keys (without raw keys).',
  })
  async getApiKeys(@CurrentUser() user: CurrentUserPayload) {
    return this.apiKeysService.getApiKeys(user);
  }

  @Delete(':id')
  @Roles('sysadmin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke (delete) an API key' })
  @ApiResponse({ status: 200, description: 'API Key revoked successfully.' })
  async revokeApiKey(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ) {
    if (!id) throw new BadRequestException('ID is required');
    return this.apiKeysService.revokeApiKey(user, id);
  }
}
