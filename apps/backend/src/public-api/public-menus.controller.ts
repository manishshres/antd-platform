import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
} from '@nestjs/swagger';
import { ApiKeyAuthGuard } from './guards/api-key-auth.guard';
import { apiPrincipal } from './api-principal';
import { MenusService } from '../menus/menus.service';
import { PaginationDto } from '../common/dto/pagination.dto';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../common/decorators/public.decorator';
import { CreateCategoryDto } from '../menus/dto/create-category.dto';
import { UpdateCategoryDto } from '../menus/dto/update-category.dto';
import { CreateItemDto } from '../menus/dto/create-item.dto';
import { UpdateItemDto } from '../menus/dto/update-item.dto';
import { CreateModifierGroupDto } from '../menus/dto/create-modifier-group.dto';
import { CreateModifierOptionDto } from '../menus/dto/create-modifier-option.dto';
import { AssignModifierDto } from '../menus/dto/assign-modifier.dto';

type ApiRequest = import('express').Request & { organizationId: string };

@ApiTags('Public API - Menus')
@ApiSecurity('x-api-key')
@Public() // Authenticated by API key, not JWT (H6).
@SkipThrottle()
@UseGuards(ApiKeyAuthGuard)
@Controller({ version: '2', path: 'menus' })
export class PublicMenusController {
  constructor(private readonly menusService: MenusService) {}

  @Get()
  @ApiOperation({ summary: 'Get the menu for the organization' })
  @ApiResponse({
    status: 200,
    description: 'Returns category-grouped menu list.',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized. Invalid API key.' })
  async getMenu(
    @Req() request: ApiRequest,
    @Query() pagination: PaginationDto,
    @Query('locationId') locationId?: string,
  ) {
    const orgId = request.organizationId;
    return this.menusService.getMenuByOrg(orgId, pagination, locationId);
  }

  @Post('categories')
  @ApiOperation({ summary: 'Create a new menu category' })
  async createCategory(@Req() request: ApiRequest, @Body() dto: CreateCategoryDto) {
    return this.menusService.createCategory(
      apiPrincipal(request.organizationId),
      dto.name,
      dto.locationId,
    );
  }

  @Patch('categories/:id')
  @ApiOperation({ summary: 'Update a category' })
  async updateCategory(
    @Req() request: ApiRequest,
    @Param('id') id: string,
    @Body() dto: UpdateCategoryDto,
  ) {
    return this.menusService.updateCategory(apiPrincipal(request.organizationId), id, dto);
  }

  @Delete('categories/:id')
  @ApiOperation({ summary: 'Delete a menu category and all its items' })
  async deleteCategory(@Req() request: ApiRequest, @Param('id') id: string) {
    return this.menusService.deleteCategory(apiPrincipal(request.organizationId), id);
  }

  @Post('items')
  @ApiOperation({ summary: 'Create a new menu item' })
  async createMenuItem(@Req() request: ApiRequest, @Body() dto: CreateItemDto) {
    return this.menusService.createMenuItem(
      apiPrincipal(request.organizationId),
      dto.categoryId,
      dto.name,
      dto.description || '',
      dto.price,
      dto.imageUrl,
      dto.locationId,
      dto.sku,
      {
        isCombo: dto.isCombo,
        taxExempt: dto.taxExempt,
        stockQuantity: dto.stockQuantity,
        lowStockThreshold: dto.lowStockThreshold,
      },
    );
  }

  @Patch('items/:id')
  @ApiOperation({ summary: 'Update a menu item (price, availability, etc.)' })
  async updateMenuItem(
    @Req() request: ApiRequest,
    @Param('id') id: string,
    @Body() dto: UpdateItemDto,
  ) {
    return this.menusService.updateMenuItem(apiPrincipal(request.organizationId), id, dto);
  }

  @Delete('items/:id')
  @ApiOperation({ summary: 'Delete a menu item' })
  async deleteMenuItem(@Req() request: ApiRequest, @Param('id') id: string) {
    return this.menusService.deleteMenuItem(apiPrincipal(request.organizationId), id);
  }

  @Get('modifiers/groups')
  @ApiOperation({ summary: 'Get all modifier groups' })
  async getModifierGroups(
    @Req() request: ApiRequest,
    @Query('locationId') locationId?: string,
  ) {
    return this.menusService.getModifierGroups(
      apiPrincipal(request.organizationId),
      locationId,
    );
  }

  @Post('modifiers/groups')
  @ApiOperation({ summary: 'Create a new modifier group (e.g. Size)' })
  async createModifierGroup(
    @Req() request: ApiRequest,
    @Body() dto: CreateModifierGroupDto,
  ) {
    return this.menusService.createModifierGroup(
      apiPrincipal(request.organizationId),
      dto.name,
      dto.locationId,
      dto.isRequired || false,
      dto.multiSelect || false,
      dto.maxSelections,
    );
  }

  @Delete('modifiers/groups/:id')
  @ApiOperation({ summary: 'Delete a modifier group' })
  async deleteModifierGroup(@Req() request: ApiRequest, @Param('id') id: string) {
    return this.menusService.deleteModifierGroup(apiPrincipal(request.organizationId), id);
  }

  @Post('modifiers/:modifierId/options')
  @ApiOperation({ summary: 'Create a new option for a modifier group' })
  async createModifierOption(
    @Req() request: ApiRequest,
    @Param('modifierId') modifierId: string,
    @Body() dto: CreateModifierOptionDto,
  ) {
    return this.menusService.createModifierOption(
      apiPrincipal(request.organizationId),
      modifierId,
      dto.name,
      dto.priceAdjustment,
    );
  }

  @Delete('modifiers/options/:id')
  @ApiOperation({ summary: 'Delete a modifier option' })
  async deleteModifierOption(@Req() request: ApiRequest, @Param('id') id: string) {
    return this.menusService.deleteModifierOption(apiPrincipal(request.organizationId), id);
  }

  @Post('items/:itemId/modifiers')
  @ApiOperation({ summary: 'Assign a modifier group to a menu item' })
  async assignModifierToItem(
    @Req() request: ApiRequest,
    @Param('itemId') itemId: string,
    @Body() dto: AssignModifierDto,
  ) {
    return this.menusService.assignModifierToItem(
      apiPrincipal(request.organizationId),
      itemId,
      dto.modifierId,
    );
  }

  @Post('upload')
  @ApiOperation({ summary: 'Upload a menu item image' })
  @UseInterceptors(FileInterceptor('file'))
  uploadImage(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('File is required');
    return { imageUrl: `/uploads/${file.originalname}` };
  }
}
