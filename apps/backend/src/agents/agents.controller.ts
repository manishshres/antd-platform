import {
  Controller,
  Get,
  Patch,
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
import { AgentsService } from './agents.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../common/decorators/current-user.decorator';

@ApiTags('Voice AI Agents')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('agents')
export class AgentsController {
  constructor(private readonly agentsService: AgentsService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'List all voice AI agents for the authenticated organization',
  })
  @ApiResponse({ status: 200, description: 'Returns list of agents.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  async listAgents(@CurrentUser() user: CurrentUserPayload): Promise<unknown> {
    return this.agentsService.listAgents(user.organizationId);
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get a single voice AI agent by ID' })
  @ApiResponse({ status: 200, description: 'Returns agent details.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 404, description: 'Agent not found.' })
  async getAgent(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ): Promise<unknown> {
    if (!id) throw new BadRequestException('Agent ID is required.');
    return this.agentsService.getAgent(id, user.organizationId);
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update a voice AI agent configuration' })
  @ApiResponse({ status: 200, description: 'Returns updated agent.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({
    status: 403,
    description: 'Agent does not belong to your organization.',
  })
  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update a voice AI agent configuration' })
  @ApiResponse({ status: 200, description: 'Returns updated agent.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({
    status: 403,
    description: 'Agent does not belong to your organization.',
  })
  async updateAgent(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ): Promise<unknown> {
    if (!id) throw new BadRequestException('Agent ID is required.');
    return this.agentsService.updateAgent(id, body, user.organizationId);
  }

  @Patch('location/:locationId/agent')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Update the voice AI agent configuration for a specific location',
  })
  @ApiResponse({ status: 200, description: 'Returns updated agent.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  async updateLocationAgent(
    @CurrentUser() user: CurrentUserPayload,
    @Param('locationId') locationId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<unknown> {
    if (!locationId) throw new BadRequestException('Location ID is required.');
    return this.agentsService.updateLocationAgent(
      locationId,
      body,
      user.organizationId,
    );
  }
}
