import { IsString, IsNotEmpty, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { CreateInvitationDto } from './create-invitation.dto';

/**
 * Platform-admin invitation body: the same fields plus the target organization.
 *
 * This exists as a real class because the route previously typed its body as
 * `CreateInvitationDto & { organizationId: string }`. An intersection has no runtime
 * constructor, so `design:paramtypes` emits `Object` and ValidationPipe skips the body
 * entirely — no email check, no role allowlist, no whitelist stripping, on an endpoint
 * that creates sysadmin invitations.
 */
export class AdminCreateInvitationDto extends CreateInvitationDto {
  @ApiProperty({ description: 'Organization the invitation belongs to' })
  @IsString()
  @IsNotEmpty()
  @IsUUID()
  organizationId!: string;
}
