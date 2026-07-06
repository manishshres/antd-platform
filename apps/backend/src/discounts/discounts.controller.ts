import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../common/decorators/current-user.decorator';
import { DiscountsService } from './discounts.service';
import { CreateDiscountDto } from './dto/create-discount.dto';
import { UpdateDiscountDto } from './dto/update-discount.dto';

@ApiTags('discounts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('discounts')
export class DiscountsController {
  constructor(private readonly discountsService: DiscountsService) {}

  @Get()
  @Roles('user', 'manager', 'admin', 'sysadmin')
  @ApiOperation({ summary: 'List discounts (active only unless ?all=true)' })
  @ApiResponse({ status: 200, description: 'Discounts returned.' })
  async list(
    @CurrentUser() user: CurrentUserPayload,
    @Query('all') all?: string,
  ) {
    return all === 'true'
      ? this.discountsService.listAll(user)
      : this.discountsService.listActive(user);
  }

  @Post()
  @Roles('manager', 'admin', 'sysadmin')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a discount / promo code' })
  @ApiResponse({ status: 201, description: 'Discount created.' })
  async create(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: CreateDiscountDto,
  ) {
    return this.discountsService.create(user, dto);
  }

  @Patch(':id')
  @Roles('manager', 'admin', 'sysadmin')
  @ApiOperation({ summary: 'Update a discount (incl. activate/deactivate)' })
  @ApiResponse({ status: 200, description: 'Discount updated.' })
  async update(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: UpdateDiscountDto,
  ) {
    return this.discountsService.update(user, id, dto);
  }

  @Delete(':id')
  @Roles('manager', 'admin', 'sysadmin')
  @ApiOperation({ summary: 'Soft-delete a discount' })
  @ApiResponse({ status: 200, description: 'Discount deleted.' })
  async remove(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ) {
    return this.discountsService.remove(user, id);
  }
}
