import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: Transporter | null = null;

  constructor(private readonly configService: ConfigService) {
    const smtpHost = this.configService.get<string>('SMTP_HOST');
    if (smtpHost) {
      const portStr = this.configService.get<string | number>('SMTP_PORT', 587);
      const port =
        typeof portStr === 'string' ? parseInt(portStr, 10) : portStr;

      this.transporter = nodemailer.createTransport({
        host: smtpHost,
        port,
        secure: port === 465,
        auth: {
          user: this.configService.get<string>('SMTP_USER'),
          pass: this.configService.get<string>('SMTP_PASS'),
        },
      });
      this.logger.log(`Mail transport configured via SMTP (${smtpHost}).`);
    } else {
      this.logger.warn(
        'SMTP_HOST not set — emails will be logged to console only (development mode).',
      );
    }
  }

  private async send(options: {
    to: string;
    subject: string;
    text: string;
    html?: string;
  }): Promise<void> {
    const from =
      this.configService.get<string>('SMTP_FROM') || 'noreply@example.com';

    if (!this.transporter) {
      // Dev mode: log the email content to console instead of sending
      this.logger.log('=== [DEV EMAIL] ===');
      this.logger.log(`To: ${options.to}`);
      this.logger.log(`Subject: ${options.subject}`);
      this.logger.log(`Body:\n${options.text}`);
      this.logger.log('==================');
      return;
    }

    try {
      await this.transporter.sendMail({
        from,
        to: options.to,
        subject: options.subject,
        text: options.text,
        html: options.html,
      });
      this.logger.log(`Email sent to ${options.to}: "${options.subject}"`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to send email to ${options.to}: ${msg}`);
      // Do not throw — email failure should never break primary request flow
    }
  }

  private getBaseEmailTemplate(
    title: string,
    paragraphs: string[],
    ctaText?: string,
    ctaUrl?: string,
    footerText?: string,
  ): string {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #333; background-color: #f5f5f5; margin: 0; padding: 0; }
          .container { max-width: 600px; margin: 40px auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.05); }
          .header { background-color: #1677ff; padding: 32px 24px; text-align: center; }
          .header h1 { margin: 0; color: #ffffff; font-size: 24px; font-weight: 600; }
          .content { padding: 32px 24px; }
          p { margin: 0 0 16px; font-size: 16px; color: #4b5563; }
          .btn-container { text-align: center; margin: 32px 0; }
          .btn { display: inline-block; background-color: #1677ff; color: #ffffff !important; text-decoration: none; padding: 12px 32px; border-radius: 6px; font-weight: 600; font-size: 16px; }
          .footer { background-color: #f9fafb; padding: 24px; text-align: center; border-top: 1px solid #e5e7eb; }
          .footer p { margin: 0; font-size: 14px; color: #9ca3af; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>${title}</h1>
          </div>
          <div class="content">
            ${paragraphs.map((p) => `<p>${p}</p>`).join('')}
            ${
              ctaText && ctaUrl
                ? `
            <div class="btn-container">
              <a href="${ctaUrl}" class="btn">${ctaText}</a>
            </div>
            `
                : ''
            }
          </div>
          ${
            footerText
              ? `
          <div class="footer">
            <p>${footerText}</p>
          </div>
          `
              : ''
          }
        </div>
      </body>
      </html>
    `;
  }

  async sendPasswordReset(to: string, resetToken: string): Promise<void> {
    const appUrl =
      this.configService.get<string>('APP_URL') || 'http://localhost:3000';
    const resetUrl = `${appUrl}/auth/reset-password?token=${resetToken}`;

    const text = [
      'You requested a password reset.',
      '',
      `Click the link below to reset your password (expires in 1 hour):`,
      resetUrl,
      '',
      'If you did not request this, please ignore this email.',
      'Your password will remain unchanged.',
    ];

    await this.send({
      to,
      subject: 'Reset your password',
      text: text.join('\n'),
      html: this.getBaseEmailTemplate(
        'Password Reset',
        [
          'We received a request to reset your password.',
          'Click the button below to choose a new password. This link will expire in 1 hour.',
        ],
        'Reset Password',
        resetUrl,
        'If you did not request a password reset, please ignore this email. Your password will remain unchanged.',
      ),
    });
  }

  async sendEmailVerification(to: string, verifyToken: string): Promise<void> {
    const appUrl =
      this.configService.get<string>('APP_URL') || 'http://localhost:3000';
    const verifyUrl = `${appUrl}/auth/verify-email?token=${verifyToken}`;

    const text = [
      'Welcome! Please verify your email address.',
      '',
      `Click the link below to verify your email (expires in 24 hours):`,
      verifyUrl,
      '',
      'If you did not create an account, please ignore this email.',
    ];

    await this.send({
      to,
      subject: 'Verify your email address',
      text: text.join('\n'),
      html: this.getBaseEmailTemplate(
        'Verify Email',
        [
          'Welcome to the platform!',
          'Please verify your email address to complete your registration. This link will expire in 24 hours.',
        ],
        'Verify Email Address',
        verifyUrl,
        'If you did not create an account, please safely ignore this email.',
      ),
    });
  }
  async sendOrganizationInvitation(
    to: string,
    token: string,
    orgName: string,
  ): Promise<void> {
    const appUrl =
      this.configService.get<string>('APP_URL') || 'http://localhost:3000';
    const acceptUrl = `${appUrl}/invitations/accept?token=${token}`;

    const text = [
      `Great news! You have been invited to join the ${orgName} team on Coneeko.`,
      '',
      `Coneeko is your all-in-one AI Voice Portal and Operations platform.`,
      '',
      `Click the link below to accept the invitation and set up your account (expires in 7 days):`,
      acceptUrl,
      '',
      'If you do not want to join this team, please ignore this email.',
    ];

    await this.send({
      to,
      subject: `You're invited to join ${orgName} on Coneeko`,
      text: text.join('\n'),
      html: this.getBaseEmailTemplate(
        "You're Invited!",
        [
          `Great news! You have been invited to join the <strong>${orgName}</strong> team on Coneeko.`,
          'Coneeko is your all-in-one AI Voice Portal and Operations platform.',
          'Click the button below to accept your invitation, set up your profile, and get started. This invitation link is valid for 7 days.',
        ],
        'Accept Invitation',
        acceptUrl,
        'If you do not want to join this team, please safely ignore this email.',
      ),
    });
  }
}
