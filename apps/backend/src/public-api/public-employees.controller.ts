import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../common/decorators/public.decorator';
import { ApiKeyAuthGuard } from './guards/api-key-auth.guard';
import { UsersService } from '../users/users.service';
import {
  AuthEmployeeByPinDto,
  VerifyManagerPinDto,
} from './dto/auth-employee-by-pin.dto';

const MANAGER_ROLES = ['manager', 'admin', 'sysadmin', 'platform_admin'];

@ApiTags('Public API - Employees')
@ApiSecurity('x-api-key')
@Public()
@SkipThrottle()
@UseGuards(ApiKeyAuthGuard)
@Controller({ version: '2', path: 'employees' })
export class PublicEmployeesController {
  constructor(private readonly usersService: UsersService) {}

  @Post('auth/pin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Sign an employee onto the POS by email + 4-digit PIN. Returns the employee profile; rejects if PIN missing/wrong.',
  })
  @ApiResponse({ status: 200, description: 'Employee signed in.' })
  @ApiResponse({ status: 401, description: 'Invalid PIN.' })
  @ApiResponse({ status: 404, description: 'No user with that email.' })
  async authByPin(
    @Req() request: import('express').Request & { organizationId: string },
    @Body() dto: AuthEmployeeByPinDto,
  ) {
    const user = await this.usersService.findOneByEmail(dto.email);
    if (!user || user.organizationId !== request.organizationId) {
      throw new UnauthorizedException('Invalid email or PIN.');
    }
    const verified = await this.usersService.verifyManagerPin(
      request.organizationId,
      dto.pin,
      user.id,
    );
    if (!verified || verified.id !== user.id) {
      throw new UnauthorizedException('Invalid email or PIN.');
    }
    return shapeEmployee(verified);
  }

  @Post('verify-manager-pin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Verify a manager PIN. If candidateEmployeeId is provided the manager must be that user; otherwise any manager in the org is accepted.',
  })
  @ApiResponse({ status: 200, description: 'Manager verified.' })
  @ApiResponse({ status: 401, description: 'Invalid PIN.' })
  async verifyManagerPin(
    @Req() request: import('express').Request & { organizationId: string },
    @Body() dto: VerifyManagerPinDto,
  ) {
    const verified = await this.usersService.verifyManagerPin(
      request.organizationId,
      dto.pin,
      dto.candidateEmployeeId,
    );
    if (!verified) {
      throw new UnauthorizedException('Invalid manager PIN.');
    }
    return shapeEmployee(verified);
  }

  @Post(':id/clock-in')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Clock an employee in. No-op if already clocked in.' })
  async clockIn(
    @Req() request: import('express').Request & { organizationId: string },
    @Param('id') id: string,
  ) {
    const user = await this.usersService.findOneById(id);
    if (!user || user.organizationId !== request.organizationId) {
      throw new UnauthorizedException('Employee not found.');
    }
    return this.usersService.clockIn(
      request.organizationId,
      id,
      user.locationId ?? undefined,
    );
  }

  @Post(':id/clock-out')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Clock an employee out of their open shift." })
  async clockOut(
    @Req() request: import('express').Request & { organizationId: string },
    @Param('id') id: string,
  ) {
    const user = await this.usersService.findOneById(id);
    if (!user || user.organizationId !== request.organizationId) {
      throw new UnauthorizedException('Employee not found.');
    }
    return this.usersService.clockOut(request.organizationId, id);
  }

  @Get(':id/clock-status')
  @ApiOperation({ summary: "Whether the employee currently has an open shift." })
  async clockStatus(
    @Req() request: import('express').Request & { organizationId: string },
    @Param('id') id: string,
  ) {
    const user = await this.usersService.findOneById(id);
    if (!user || user.organizationId !== request.organizationId) {
      throw new UnauthorizedException('Employee not found.');
    }
    const open = await this.usersService.getOpenClockEntry(
      request.organizationId,
      id,
    );
    return { clockedIn: !!open, since: open?.clockInAt ?? null };
  }
}

function shapeEmployee(user: {
  id: string;
  email: string;
  role: string;
  firstName: string | null;
  lastName: string | null;
  organizationId: string | null;
  locationId: string | null;
}) {
  const role = user.role;
  const isManager = MANAGER_ROLES.includes(role);
  const displayName = [user.firstName, user.lastName]
    .filter((s) => Boolean(s?.trim()))
    .join(' ')
    .trim();
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    displayName: displayName || user.email,
    role,
    isManager,
    organizationId: user.organizationId,
    locationId: user.locationId,
  };
}
