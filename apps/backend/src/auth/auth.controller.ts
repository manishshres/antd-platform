import {
  Controller,
  Post,
  Body,
  UnauthorizedException,
  HttpCode,
  HttpStatus,
  UseGuards,
  Get,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { AuthService } from './auth.service';
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
  @ApiOperation({ summary: 'Register a new user account' })
  @ApiResponse({ status: 201, description: 'User successfully created.' })
  @ApiResponse({ status: 400, description: 'Validation failed.' })
  @ApiResponse({ status: 409, description: 'Email address already in use.' })
  async register(@Body() registerDto: RegisterDto) {
    const passwordHash = await this.authService.hashPassword(
      registerDto.password,
    );
    await this.authService.register(
      registerDto.email,
      passwordHash,
      registerDto.firstName,
      registerDto.lastName,
      registerDto.companyName,
      registerDto.phoneNumber,
    );
    return {
      id: '',
      email: '',
      role: '',
      createdAt: new Date(),
    };
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
  async login(@Body() loginDto: LoginDto) {
    const user = await this.authService.validateUser(
      loginDto.email,
      loginDto.password,
    );
    if (!user) {
      throw new UnauthorizedException('Invalid email or password.');
    }
    return this.authService.login(user, loginDto.rememberMe ?? false);
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
  async refresh(@Body('refresh_token') refreshToken: string) {
    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token is required.');
    }
    return this.authService.refresh(refreshToken);
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Logout and invalidate the refresh token' })
  @ApiResponse({ status: 200, description: 'Logout successful.' })
  async logout(@Body('refresh_token') refreshToken: string) {
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
