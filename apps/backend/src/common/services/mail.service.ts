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
    const brandName = this.configService.get<string>('BRAND_NAME') || 'Coneeko';
    const appUrl =
      this.configService.get<string>('FRONTEND_URL') || 'https://coneeko.com';
    const year = new Date().getFullYear();

    const paragraphsHtml = paragraphs
      .map(
        (p) => `
          <p style="margin:0 0 18px;font-size:16px;line-height:1.65;color:#3f3f46;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
            ${p}
          </p>`,
      )
      .join('');

    const ctaHtml =
      ctaText && ctaUrl
        ? `
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:32px 0 8px;">
            <tr>
              <td align="center" bgcolor="#4f46e5" style="border-radius:10px;background-image:linear-gradient(135deg,#6366f1 0%,#4f46e5 50%,#7c3aed 100%);box-shadow:0 6px 20px -6px rgba(79,70,229,0.55);">
                <a href="${ctaUrl}"
                   style="display:inline-block;padding:15px 34px;font-size:15px;font-weight:600;letter-spacing:0.2px;color:#ffffff;text-decoration:none;border-radius:10px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
                  ${ctaText}
                </a>
              </td>
            </tr>
          </table>
          <p style="margin:16px 0 0;font-size:13px;line-height:1.6;color:#71717a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
            Or copy and paste this URL into your browser:<br />
            <a href="${ctaUrl}" style="color:#4f46e5;text-decoration:none;word-break:break-all;">${ctaUrl}</a>
          </p>`
        : '';

    const footerBlock = footerText
      ? `
          <tr>
            <td style="padding:24px 40px;background-color:#fafafa;border-top:1px solid #e4e4e7;">
              <p style="margin:0;font-size:13px;line-height:1.6;color:#71717a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
                ${footerText}
              </p>
            </td>
          </tr>`
      : '';

    return `<!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width,initial-scale=1" />
      <meta http-equiv="X-UA-Compatible" content="IE=edge" />
      <title>${title}</title>
    </head>
    <body style="margin:0;padding:0;background-color:#f4f4f7;-webkit-font-smoothing:antialiased;">
      <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${title} — ${brandName}</div>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f4f4f7;">
        <tr>
          <td align="center" style="padding:40px 16px;">
            <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px -8px rgba(15,23,42,0.12);">
              <!-- Header -->
              <tr>
                <td style="padding:28px 40px;background-image:linear-gradient(135deg,#6366f1 0%,#4f46e5 50%,#7c3aed 100%);">
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                    <tr>
                      <td style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:20px;font-weight:700;color:#ffffff;letter-spacing:-0.2px;">
                        ${brandName}
                      </td>
                      <td align="right" style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;color:rgba(255,255,255,0.75);letter-spacing:0.3px;text-transform:uppercase;">
                        AI Voice Portal
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>

              <!-- Title -->
              <tr>
                <td style="padding:44px 40px 8px;">
                  <h1 style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:26px;line-height:1.25;font-weight:700;color:#0f172a;letter-spacing:-0.4px;">
                    ${title}
                  </h1>
                  <div style="width:44px;height:3px;margin-top:14px;border-radius:999px;background-image:linear-gradient(90deg,#6366f1,#7c3aed);"></div>
                </td>
              </tr>

              <!-- Body -->
              <tr>
                <td style="padding:24px 40px 40px;">
                  ${paragraphsHtml}
                  ${ctaHtml}
                </td>
              </tr>

              ${footerBlock}

              <!-- Brand footer -->
              <tr>
                <td style="padding:20px 40px 28px;background-color:#0f172a;" align="center">
                  <p style="margin:0 0 6px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;color:#e2e8f0;font-weight:600;">
                    ${brandName}
                  </p>
                  <p style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;color:#94a3b8;">
                    <a href="${appUrl}" style="color:#94a3b8;text-decoration:none;">${appUrl.replace(/^https?:\/\//, '')}</a>
                    &nbsp;·&nbsp; © ${year} ${brandName}. All rights reserved.
                  </p>
                </td>
              </tr>
            </table>

            <p style="margin:16px 0 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;color:#a1a1aa;">
              You received this email because an action was taken on your ${brandName} account.
            </p>
          </td>
        </tr>
      </table>
    </body>
  </html>`;
  }

  async sendPasswordReset(to: string, resetToken: string): Promise<void> {
    const appUrl =
      this.configService.get<string>('FRONTEND_URL') || 'http://localhost:3000';
    const resetUrl = `${appUrl}/reset-password?token=${resetToken}`;

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
      this.configService.get<string>('FRONTEND_URL') || 'http://localhost:3000';
    const verifyUrl = `${appUrl}/verify-email?token=${verifyToken}`;

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
      this.configService.get<string>('FRONTEND_URL') || 'http://localhost:3000';
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
