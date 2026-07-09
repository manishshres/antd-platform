import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { ConversationsService } from './conversations.service';
import { PaginationDto } from '../common/dto/pagination.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../common/decorators/current-user.decorator';

@ApiTags('Conversations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('conversations')
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  @Get()
  @Roles('manager')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List chat conversations' })
  @ApiQuery({ name: 'locationId', required: false, type: String })
  async listConversations(
    @CurrentUser() user: CurrentUserPayload,
    @Query() pagination: PaginationDto,
    @Query('locationId') locationId?: string,
  ) {
    return this.conversationsService.listConversations(
      user,
      pagination,
      locationId,
    );
  }

  @Get(':id')
  @Roles('manager')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get a specific chat conversation thread' })
  async getConversation(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ) {
    return this.conversationsService.getConversation(user, id);
  }

  @Post('sync')
  @Roles('manager')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sync AI Assistant conversations from Telnyx' })
  async syncConversations(
    @CurrentUser() user: CurrentUserPayload,
    @Body() body: { locationId: string; telnyxAssistantId: string },
    @Query('orgId') queryOrgId?: string,
  ) {
    const orgId = queryOrgId || user.organizationId;
    if (!orgId) throw new Error('User has no organizationId');

    const count = await this.conversationsService.syncFromTelnyx(
      orgId,
      body.locationId,
      body.telnyxAssistantId,
    );
    return { success: true, syncedCount: count };
  }
}
