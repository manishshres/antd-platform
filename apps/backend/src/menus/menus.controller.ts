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
  Query,
  Patch,
  UploadedFile,
  UseInterceptors,
  ForbiddenException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { Readable } from 'stream';
import { MenusService } from './menus.service';
import { StorageService } from '../storage/storage.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { CreateItemDto } from './dto/create-item.dto';
import { ImportMenuDto } from './dto/import-menu.dto';
import { CreateModifierGroupDto } from './dto/create-modifier-group.dto';
import { CreateModifierOptionDto } from './dto/create-modifier-option.dto';
import { AssignModifierDto } from './dto/assign-modifier.dto';
import { UpdateItemDto } from './dto/update-item.dto';
import { ReorderDto } from './dto/reorder.dto';
import { PaginationDto } from '../common/dto/pagination.dto';
import { PaginatedResponseDto } from '../common/dto/paginated-response.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { PlanLimitGuard } from '../billing/guards/plan-limit.guard';
import { CheckLimit } from '../billing/decorators/check-limit.decorator';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../common/decorators/current-user.decorator';

@ApiTags('Menus')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('menus')
export class MenusController {
  constructor(
    private readonly menusService: MenusService,
    private readonly storageService: StorageService,
  ) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get the category-grouped menu for the authenticated organization',
  })
  @ApiResponse({
    status: 200,
    description: 'Returns category-grouped menu list.',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  async getMenu(
    @CurrentUser() user: CurrentUserPayload,
    @Query() pagination: PaginationDto,
    @Query('locationId') locationId?: string,
  ): Promise<PaginatedResponseDto<unknown>> {
    return this.menusService.getMenu(user, pagination, locationId);
  }

  @Post('sync-ai')
  @Roles('platform_admin', 'sysadmin', 'manager')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Upload current menu to Telnyx Storage and trigger AI Embedding',
  })
  @ApiResponse({
    status: 200,
    description: 'Menu synced successfully.',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  async syncMenuToAI(
    @CurrentUser() user: CurrentUserPayload,
    @Query('locationId') locationId?: string,
  ): Promise<{ success: boolean; message: string }> {
    if (!user.organizationId) {
      throw new ForbiddenException(
        'User is not associated with an organization.',
      );
    }
    return this.menusService.syncMenuToAI(user.organizationId, locationId);
  }

  @Post('cache/clear')
  @Roles('sysadmin', 'platform_admin', 'manager')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Clear the menu cache for the current organization',
  })
  @ApiResponse({ status: 200, description: 'Cache cleared.' })
  async clearMenuCache(
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ cleared: boolean }> {
    return this.menusService.clearMenuCache(user);
  }

  @Post('categories')
  @Roles('sysadmin')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new menu category' })
  @ApiResponse({ status: 201, description: 'Category created.' })
  @ApiResponse({ status: 400, description: 'Validation failed.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  async createCategory(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: CreateCategoryDto,
  ): Promise<unknown> {
    return this.menusService.createCategory(user, dto.name, dto.locationId);
  }

  @Patch('categories/:id')
  @ApiOperation({ summary: 'Update a category' })
  @ApiResponse({ status: 200, description: 'Category updated successfully.' })
  @Roles('sysadmin', 'manager')
  async updateCategory(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: UpdateCategoryDto,
  ) {
    return this.menusService.updateCategory(user, id, dto);
  }

  @Delete('categories/:id')
  @Roles('sysadmin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a menu category and all its items' })
  @ApiResponse({ status: 200, description: 'Category deleted.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 404, description: 'Category not found.' })
  async deleteCategory(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ): Promise<{ success: boolean }> {
    if (!id) throw new BadRequestException('Category ID is required.');
    return this.menusService.deleteCategory(user, id);
  }

  @Post('items')
  @Roles('sysadmin')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new menu item' })
  @ApiResponse({ status: 201, description: 'Menu item created.' })
  @ApiResponse({ status: 400, description: 'Validation failed.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  async createMenuItem(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: CreateItemDto,
  ): Promise<unknown> {
    return this.menusService.createMenuItem(
      user,
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

  @Delete('items/:id')
  @Roles('sysadmin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a menu item' })
  @ApiResponse({ status: 200, description: 'Menu item deleted.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 404, description: 'Menu item not found.' })
  async deleteMenuItem(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ): Promise<{ success: boolean }> {
    if (!id) throw new BadRequestException('Item ID is required.');
    return this.menusService.deleteMenuItem(user, id);
  }

  @Post('import')
  @Roles('platform_admin', 'sysadmin', 'manager')
  @UseGuards(PlanLimitGuard)
  @CheckLimit('websiteImports')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Import a restaurant menu from a website URL using AI extraction',
  })
  @ApiResponse({
    status: 402,
    description: 'Monthly website-import plan limit reached.',
  })
  @ApiResponse({
    status: 200,
    description:
      'Menu import queued. Poll /menus/import/status/:jobId for progress.',
  })
  @ApiResponse({ status: 400, description: 'Invalid URL or crawl failure.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  async importMenu(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: ImportMenuDto,
  ): Promise<unknown> {
    return this.menusService.importFromWebsite(
      user,
      dto.url || '',
      dto.orgId,
      dto.locationId,
      dto.importMode || 'sync',
    );
  }

  @Post('import/upload-pdf')
  @Roles('platform_admin', 'sysadmin', 'manager')
  // P3-002: a multi-layered upload guard — `fileFilter` enforces MIME at the
  // multer boundary, `limits.fileSize` caps total bytes (a malicious manager
  // cannot upload a 4 GB blob), and the controller additionally verifies the
  // PDF "magic bytes" `%PDF-` before persisting. The S3 object key is
  // server-assigned with a hard-coded `.pdf` extension — we deliberately drop
  // the client-supplied extension so `evil.exe` masquerading as `evil.pdf`
  // doesn't survive the trip to S3.
  @UseInterceptors(
    FileInterceptor('file', {
      fileFilter: (_req, file, cb) => {
        const looksLikePdf =
          file.mimetype === 'application/pdf' ||
          file.mimetype === 'application/octet-stream';
        if (!looksLikePdf) {
          return cb(
            new BadRequestException('Only PDF uploads are allowed.'),
            false,
          );
        }
        cb(null, true);
      },
      limits: {
        fileSize: 20 * 1024 * 1024, // 20 MB
        files: 1,
      },
    }),
  )
  @ApiOperation({ summary: 'Upload a PDF menu to be imported' })
  async uploadPdf(
    @CurrentUser() user: CurrentUserPayload,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<{ url: string }> {
    void user; // RBAC already enforced by @Roles guard above
    if (!file) {
      throw new BadRequestException('No file uploaded.');
    }
    if (file.size === 0) {
      throw new BadRequestException('Uploaded file is empty.');
    }
    // Magic-byte sniff: PDF files start with `%PDF-` (hex 25 50 44 46 2d).
    const head = file.buffer.subarray(0, 5);
    if (!head.equals(Buffer.from('%PDF-'))) {
      throw new BadRequestException(
        'Uploaded file does not look like a PDF (magic bytes mismatch).',
      );
    }
    const key = `menus/pdf-${Date.now()}-${Math.random().toString(36).substring(7)}.pdf`;
    const stream = Readable.from(file.buffer);

    const s3Key = await this.storageService.uploadStream(
      key,
      stream,
      'application/pdf',
    );
    return { url: s3Key };
  }

  @Get('import/status/:jobId')
  @Roles('sysadmin', 'platform_admin', 'manager')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Poll the status of a menu import job',
    description:
      'Returns the job state: waiting | active | completed | failed. Poll every 2-5 seconds until state is completed or failed.',
  })
  @ApiResponse({
    status: 200,
    description: 'Returns job state, progress, result, and error info.',
  })
  @ApiResponse({ status: 404, description: 'Job not found.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  async getImportStatus(
    @CurrentUser() _user: CurrentUserPayload,
    @Param('jobId') jobId: string,
  ): Promise<unknown> {
    if (!jobId) throw new BadRequestException('jobId is required.');
    return this.menusService.getImportJobStatus(jobId);
  }

  @Post('modifiers/groups')
  @Roles('sysadmin', 'manager')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new modifier group (e.g. Size)' })
  @ApiResponse({ status: 201, description: 'Modifier group created.' })
  async createModifierGroup(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: CreateModifierGroupDto,
  ): Promise<unknown> {
    return this.menusService.createModifierGroup(
      user,
      dto.name,
      dto.locationId,
      dto.isRequired || false,
      dto.multiSelect || false,
      dto.maxSelections,
    );
  }

  @Post('modifiers/:modifierId/options')
  @Roles('sysadmin', 'manager')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new option for a modifier group' })
  @ApiResponse({ status: 201, description: 'Modifier option created.' })
  async createModifierOption(
    @CurrentUser() user: CurrentUserPayload,
    @Param('modifierId') modifierId: string,
    @Body() dto: CreateModifierOptionDto,
  ): Promise<unknown> {
    return this.menusService.createModifierOption(
      user,
      modifierId,
      dto.name,
      dto.priceAdjustment,
    );
  }

  @Post('items/:itemId/modifiers')
  @Roles('sysadmin', 'manager')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Assign a modifier group to a menu item' })
  @ApiResponse({ status: 200, description: 'Modifier attached to menu item.' })
  async assignModifierToItem(
    @CurrentUser() user: CurrentUserPayload,
    @Param('itemId') itemId: string,
    @Body() dto: AssignModifierDto,
  ): Promise<unknown> {
    return this.menusService.assignModifierToItem(user, itemId, dto.modifierId);
  }

  @Delete('items/:itemId/modifiers/:modifierId')
  @Roles('sysadmin', 'manager')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove a modifier group from a menu item' })
  async removeModifierFromItem(
    @CurrentUser() user: CurrentUserPayload,
    @Param('itemId') itemId: string,
    @Param('modifierId') modifierId: string,
  ): Promise<unknown> {
    return this.menusService.removeModifierFromItem(user, itemId, modifierId);
  }

  // --- NEW ROUTES FOR PHASE 10 ---

  @Post('categories/:categoryId/modifiers')
  @Roles('sysadmin', 'manager')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Assign a modifier group to a category' })
  async assignModifierToCategory(
    @CurrentUser() user: CurrentUserPayload,
    @Param('categoryId') categoryId: string,
    @Body() dto: AssignModifierDto,
  ): Promise<unknown> {
    return this.menusService.assignModifierToCategory(user, categoryId, dto.modifierId);
  }

  @Delete('categories/:categoryId/modifiers/:modifierId')
  @Roles('sysadmin', 'manager')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove a modifier group from a category' })
  async removeModifierFromCategory(
    @CurrentUser() user: CurrentUserPayload,
    @Param('categoryId') categoryId: string,
    @Param('modifierId') modifierId: string,
  ): Promise<unknown> {
    return this.menusService.removeModifierFromCategory(user, categoryId, modifierId);
  }

  @Patch('items/:id')
  @Roles('sysadmin', 'manager')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update a menu item' })
  async updateMenuItem(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: UpdateItemDto,
  ) {
    return this.menusService.updateMenuItem(user, id, dto);
  }

  @Post('categories/:id/restore')
  @Roles('sysadmin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Restore a deleted category' })
  async restoreCategory(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ) {
    return this.menusService.restoreCategory(user, id);
  }

  @Post('items/:id/restore')
  @Roles('sysadmin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Restore a deleted menu item' })
  async restoreMenuItem(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ) {
    return this.menusService.restoreMenuItem(user, id);
  }

  @Patch('reorder/categories')
  @Roles('sysadmin', 'manager')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reorder categories' })
  async reorderCategories(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: ReorderDto,
  ) {
    return this.menusService.reorderCategories(user, dto.items);
  }

  @Patch('reorder/items')
  @Roles('sysadmin', 'manager')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reorder items' })
  async reorderMenuItems(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: ReorderDto,
  ) {
    return this.menusService.reorderMenuItems(user, dto.items);
  }

  @Get('modifiers/groups')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get all modifier groups' })
  async getModifierGroups(
    @CurrentUser() user: CurrentUserPayload,
    @Query('locationId') locationId?: string,
  ) {
    return this.menusService.getModifierGroups(user, locationId);
  }

  @Delete('modifiers/groups/:id')
  @Roles('sysadmin', 'manager')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a modifier group' })
  async deleteModifierGroup(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ) {
    return this.menusService.deleteModifierGroup(user, id);
  }

  @Delete('modifiers/options/:id')
  @Roles('sysadmin', 'manager')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a modifier option' })
  async deleteModifierOption(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ) {
    return this.menusService.deleteModifierOption(user, id);
  }

  @Post('upload')
  @Roles('sysadmin', 'manager')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'Upload a menu item image' })
  uploadImage(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('File is required');
    // Simplified local upload for now. In prod, this uploads to S3/R2 and returns the URL.
    return { imageUrl: `/uploads/${file.originalname}` };
  }
}
