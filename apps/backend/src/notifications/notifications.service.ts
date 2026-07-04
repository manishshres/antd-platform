import { Injectable, Logger } from '@nestjs/common';
import { TelnyxService } from '../telnyx/telnyx.service';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly systemPhone: string;
  private readonly alertPhone: string | undefined;

  constructor(
    private readonly telnyxService: TelnyxService,
    private readonly configService: ConfigService,
  ) {
    this.systemPhone =
      this.configService.get<string>('TELNYX_PHONE_NUMBER') || '+10000000000';
    this.alertPhone = this.configService.get<string>(
      'SYSTEM_ALERT_PHONE_NUMBER',
    );
  }

  async sendCriticalAlert(message: string): Promise<void> {
    if (!this.alertPhone) {
      this.logger.warn(
        `No SYSTEM_ALERT_PHONE_NUMBER configured. Alert not sent: ${message}`,
      );
      return;
    }

    try {
      await this.telnyxService.sendMessage(
        this.systemPhone,
        this.alertPhone,
        `CRITICAL ALERT: ${message}`,
      );
      this.logger.log(`Critical alert sent to ${this.alertPhone}`);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to send critical alert via SMS: ${errMsg}`);
    }
  }

  async sendSmsAlert(toPhone: string, message: string): Promise<void> {
    try {
      await this.telnyxService.sendMessage(this.systemPhone, toPhone, message);
      this.logger.log(`SMS alert sent to ${toPhone}`);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to send SMS alert: ${errMsg}`);
    }
  }
}
