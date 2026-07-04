import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';
import { DocumentsService } from './documents.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../common/decorators/current-user.decorator';

@ApiTags('Documents (Knowledge Base)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('documents')
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'List all knowledge base documents for the organization',
  })
  @ApiResponse({ status: 200, description: 'Returns document list.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  async listDocuments(
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<unknown> {
    return this.documentsService.listDocuments(user.organizationId);
  }

  @Post()
  @Roles('sysadmin')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiOperation({ summary: 'Upload a document to the knowledge base' })
  @ApiResponse({ status: 201, description: 'Document uploaded.' })
  @ApiResponse({ status: 400, description: 'No file provided.' })
  @ApiResponse({
    status: 422,
    description: 'File failed security validation.',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  async uploadDocument(
    @CurrentUser() user: CurrentUserPayload,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<unknown> {
    if (!file) {
      throw new BadRequestException('No file provided.');
    }

    return this.documentsService.uploadDocument(
      user.organizationId,
      file.originalname,
      file.buffer,
      file.mimetype,
    );
  }

  @Delete(':id')
  @Roles('sysadmin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a document from the knowledge base' })
  @ApiResponse({ status: 200, description: 'Document deleted.' })
  @ApiResponse({ status: 400, description: 'Missing document ID.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden from deleting this document.',
  })
  async deleteDocument(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ): Promise<{ ok: boolean }> {
    if (!id) {
      throw new BadRequestException('Document ID is required.');
    }
    await this.documentsService.deleteDocument(id, user.organizationId);
    return { ok: true };
  }
}
