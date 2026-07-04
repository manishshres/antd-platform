import {
  Controller,
  Get,
  Post,
  Patch,
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
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PlatformAdminGuard } from '../auth/guards/platform-admin.guard';
import { Roles } from '../common/decorators/roles.decorator';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../common/decorators/current-user.decorator';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { CreateTeamMemberDto } from './dto/create-team-member.dto';
import { UpdateUserDto, UpdateUserGlobalDto } from './dto/update-user.dto';
import { UpdateMeDto } from './dto/update-me.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { PaginationDto } from '../common/dto/pagination.dto';
import { PaginatedResponseDto } from '../common/dto/paginated-response.dto';
import { Query } from '@nestjs/common';

@ApiTags('Users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // ─── Self Profile Endpoints ──────────────────────────────────────────────

  @Get('me')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get current user profile' })
  @ApiResponse({ status: 200, description: 'Returns profile details.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  async getMe(@CurrentUser() user: CurrentUserPayload) {
    return this.usersService.getMe(user.id);
  }

  @Patch('me')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update current user profile' })
  @ApiResponse({ status: 200, description: 'Profile updated.' })
  @ApiResponse({ status: 400, description: 'Validation failed.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  async updateMe(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: UpdateMeDto,
  ) {
    return this.usersService.updateMe(user.id, dto);
  }

  @Patch('me/password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Change current user password' })
  @ApiResponse({ status: 200, description: 'Password changed.' })
  @ApiResponse({ status: 401, description: 'Current password incorrect.' })
  async changeMyPassword(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.usersService.changeMyPassword(user.id, dto);
  }

  @Delete('me')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete current user account (Self-service)' })
  @ApiResponse({ status: 200, description: 'Account deleted successfully.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  async deleteMe(@CurrentUser() user: CurrentUserPayload) {
    return this.usersService.deleteMe(user.id);
  }

  // ─── Admin/Owner Management Endpoints ────────────────────────────────────

  @Get('global')
  @UseGuards(PlatformAdminGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'List all users across all organizations (Platform Admin only)',
  })
  @ApiResponse({ status: 200, description: 'Returns all users.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  async listAllUsersGlobal(
    @CurrentUser() user: CurrentUserPayload,
    @Query() pagination: PaginationDto,
  ): Promise<PaginatedResponseDto<unknown>> {
    return this.usersService.listAllUsersGlobal(pagination);
  }

  @Post('global')
  @UseGuards(PlatformAdminGuard)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a user globally (Platform Admin only)',
  })
  @ApiResponse({ status: 201, description: 'User created successfully.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  async createUserGlobal(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: CreateUserDto,
  ) {
    return this.usersService.createUserGlobal(dto);
  }

  @Get('global/:id')
  @UseGuards(PlatformAdminGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get details of a specific user globally (Platform Admin only)',
  })
  @ApiResponse({ status: 200, description: 'Returns user details.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  @ApiResponse({ status: 404, description: 'User not found.' })
  async getUserGlobal(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ) {
    return this.usersService.getUserGlobal(id);
  }

  @Patch('global/:id')
  @UseGuards(PlatformAdminGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Update any user details globally by ID (Platform Admin only)',
  })
  @ApiResponse({ status: 200, description: 'User updated successfully.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  async updateUserGlobal(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: UpdateUserGlobalDto,
  ) {
    return this.usersService.updateUserGlobal(id, dto);
  }

  @Delete('global/:id')
  @UseGuards(PlatformAdminGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Soft-delete any user globally by ID (Platform Admin only)',
  })
  @ApiResponse({ status: 200, description: 'User deleted successfully.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  async deleteUserGlobal(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ) {
    return this.usersService.deleteUserGlobal(id);
  }

  @Post('global/:id/force-logout')
  @UseGuards(PlatformAdminGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Revoke all refresh tokens for any user globally (Platform Admin only)',
  })
  @ApiResponse({ status: 200, description: 'User forced logged out.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  async forceLogoutGlobal(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ) {
    return this.usersService.forceLogoutGlobal(id);
  }

  @Get()
  @Roles('sysadmin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List all users in the organization (Admin only)' })
  @ApiResponse({ status: 200, description: 'Returns list of users.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  async listUsers(
    @CurrentUser() user: CurrentUserPayload,
    @Query() pagination: PaginationDto,
  ): Promise<PaginatedResponseDto<unknown>> {
    if (!user.organizationId) {
      throw new BadRequestException('Organization is required.');
    }
    return this.usersService.listUsers(user.organizationId, pagination);
  }

  @Post()
  @Roles('sysadmin')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Add a new team member to the organization (Admin only)',
  })
  @ApiResponse({ status: 201, description: 'Team member added successfully.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  async createTeamMember(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: CreateTeamMemberDto,
  ) {
    if (!user.organizationId) {
      throw new BadRequestException('Organization is required.');
    }
    return this.usersService.createTeamMember(user.organizationId, dto);
  }

  @Get(':id')
  @Roles('sysadmin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get details of a specific user in the org (Admin only)',
  })
  @ApiResponse({ status: 200, description: 'Returns user details.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  @ApiResponse({ status: 404, description: 'User not found.' })
  async getUser(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ) {
    if (!user.organizationId) {
      throw new BadRequestException('Organization is required.');
    }
    return this.usersService.getUserById(id, user.organizationId);
  }

  @Patch(':id')
  @Roles('sysadmin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Update details or role of a user in the org (Admin only)',
  })
  @ApiResponse({ status: 200, description: 'User updated.' })
  @ApiResponse({ status: 400, description: 'Validation failed.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  @ApiResponse({ status: 404, description: 'User not found.' })
  async updateUser(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
  ) {
    if (!user.organizationId) {
      throw new BadRequestException('Organization is required.');
    }
    return this.usersService.updateUser(id, user.organizationId, dto);
  }

  @Delete(':id')
  @Roles('sysadmin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Soft-delete a user from the organization (Admin only)',
  })
  @ApiResponse({ status: 200, description: 'User removed.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  @ApiResponse({ status: 404, description: 'User not found.' })
  async deleteUser(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ) {
    if (!user.organizationId) {
      throw new BadRequestException('Organization is required.');
    }
    if (user.id === id) {
      throw new BadRequestException('You cannot delete your own user account.');
    }
    return this.usersService.deleteUser(id, user.organizationId);
  }

  @Post(':id/force-logout')
  @Roles('sysadmin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Revoke all refresh tokens for a user (Admin only)',
  })
  @ApiResponse({ status: 200, description: 'User forced logged out.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  @ApiResponse({ status: 404, description: 'User not found.' })
  async forceLogout(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ) {
    if (!user.organizationId) {
      throw new BadRequestException('Organization is required.');
    }
    return this.usersService.forceLogout(id, user.organizationId);
  }
}
