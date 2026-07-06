import {
  Controller,
  Post,
  Body,
  Req,
  Res,
  UnauthorizedException,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  UseGuards,
  Get,
} from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import {
  AuthService,
  REFRESH_TTL_DEFAULT,
  REFRESH_TTL_REMEMBER_ME,
} from './auth.service';
import {
  setRefreshCookie,
  clearRefreshCookie,
  readRefreshCookie,
} from './refresh-cookie';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { Public } from '../common/decorators/public.decorator';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../common/decorators/current-user.decorator';

@ApiTags('Authentication')
@UseGuards(ThrottlerGuard)
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('register')
  @ApiOperation({ summary: 'Register a new user account (disabled)' })
  @ApiResponse({ status: 403, description: 'Self-registration is disabled.' })
  register(@Body() _registerDto: RegisterDto) {
    // Self-registration is disabled — organizations and users are created by a platform admin
    // and joined via invitation.
    throw new ForbiddenException(
      'Self-registration is disabled. Contact your platform administrator for an invitation.',
    );
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login and receive access + refresh tokens' })
  @ApiResponse({
    status: 200,
    description: 'Login successful. Returns access and refresh tokens.',
  })
  @ApiResponse({ status: 401, description: 'Invalid credentials.' })
  @ApiResponse({
    status: 429,
    description: 'Account locked after too many failed attempts.',
  })
  async login(
    @Body() loginDto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const user = await this.authService.validateUser(
      loginDto.email,
      loginDto.password,
    );
    if (!user) {
      throw new UnauthorizedException('Invalid email or password.');
    }
    const rememberMe = loginDto.rememberMe ?? false;
    const result = await this.authService.login(user, rememberMe);

    // Deliver the refresh token as an HttpOnly cookie so the frontend never has to persist it
    // in localStorage (H2). The token is still in the body for non-browser API clients.
    const maxAgeMs =
      (rememberMe ? REFRESH_TTL_REMEMBER_ME : REFRESH_TTL_DEFAULT) * 1000;
    setRefreshCookie(res, result.refresh_token, maxAgeMs);

    return result;
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Rotate refresh token and receive a new access token',
  })
  @ApiResponse({
    status: 200,
    description: 'Access token successfully refreshed.',
  })
  @ApiResponse({
    status: 401,
    description: 'Invalid or expired refresh token.',
  })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body('refresh_token') bodyToken?: string,
  ) {
    // Prefer the HttpOnly cookie; fall back to the body for non-browser / legacy clients (H2).
    const refreshToken = readRefreshCookie(req) ?? bodyToken;
    if (!refreshToken) {
      clearRefreshCookie(res);
      throw new UnauthorizedException('Refresh token is required.');
    }

    try {
      const result = await this.authService.refresh(refreshToken);

      // Rotate the cookie to the new refresh token (default TTL; rememberMe isn't known here).
      setRefreshCookie(res, result.refresh_token, REFRESH_TTL_DEFAULT * 1000);

      return result;
    } catch (error) {
      clearRefreshCookie(res);
      throw error;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Logout and invalidate the refresh token' })
  @ApiResponse({ status: 200, description: 'Logout successful.' })
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body('refresh_token') bodyToken?: string,
  ) {
    const refreshToken = readRefreshCookie(req) ?? bodyToken;
    clearRefreshCookie(res);
    if (!refreshToken) {
      return { success: true };
    }
    return this.authService.logout(refreshToken);
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Request a password reset email',
    description:
      'Always returns 200 regardless of whether the email exists, to prevent email enumeration.',
  })
  @ApiResponse({
    status: 200,
    description: 'If the email exists, a reset link has been sent.',
  })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    await this.authService.forgotPassword(dto.email);
    return {
      message:
        'If an account with that email exists, a password reset link has been sent.',
    };
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reset password using a reset token from email' })
  @ApiResponse({ status: 200, description: 'Password successfully reset.' })
  @ApiResponse({
    status: 400,
    description: 'Token is invalid, expired, or already used.',
  })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.authService.resetPassword(dto.token, dto.newPassword);
    return { message: 'Password has been reset successfully. Please log in.' };
  }

  @Public()
  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify email address using a verification token' })
  @ApiResponse({ status: 200, description: 'Email verified successfully.' })
  @ApiResponse({
    status: 400,
    description: 'Token is invalid or expired.',
  })
  async verifyEmail(@Body() dto: VerifyEmailDto) {
    await this.authService.verifyEmail(dto.token);
    return { message: 'Email verified successfully.' };
  }

  @UseGuards(JwtAuthGuard)
  @Post('resend-verification')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Resend the email verification link' })
  @ApiResponse({ status: 200, description: 'Verification email resent.' })
  @ApiResponse({ status: 400, description: 'Email already verified.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  async resendVerification(@CurrentUser() user: CurrentUserPayload) {
    await this.authService.resendVerification(user.id);
    return { message: 'Verification email has been resent.' };
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get the currently authenticated user profile' })
  @ApiResponse({ status: 200, description: 'Returns authenticated user info.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  getProfile(@CurrentUser() user: CurrentUserPayload) {
    return user;
  }
}
