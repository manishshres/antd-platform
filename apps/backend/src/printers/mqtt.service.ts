import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as mqtt from 'mqtt';

export type MqttMessageHandler = (
  topic: string,
  payload: Buffer,
) => void | Promise<void>;

@Injectable()
export class MqttService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MqttService.name);
  private client: mqtt.MqttClient | null = null;
  private isConnected = false;

  /** Handlers registered before the client connects are applied on connect */
  private readonly pendingSubscriptions: Map<string, MqttMessageHandler[]> =
    new Map();

  private readonly offlineQueue: Array<{
    topic: string;
    message: string | Buffer;
    options: mqtt.IClientPublishOptions;
  }> = [];
  private readonly offlineQueueMaxSize = 200;
  private readonly regexCache = new Map<string, RegExp>();

  constructor(private readonly configService: ConfigService) {}

  getIsConnected(): boolean {
    return this.isConnected;
  }

  onModuleInit() {
    const brokerUrl =
      this.configService.get<string>('MQTT_BROKER_URL') ||
      'mqtt://localhost:1883';
    const username = this.configService.get<string>('MQTT_USERNAME');
    const password = this.configService.get<string>('MQTT_PASSWORD');
    const clientId = `antd-backend-${Math.random().toString(16).slice(2, 8)}`;

    this.logger.log(`Connecting to MQTT broker at ${brokerUrl}...`);

    const options: mqtt.IClientOptions = {
      clientId,
      reconnectPeriod: 5000,
      connectTimeout: 10000,
      // Last Will & Testament — broker publishes this if the backend disconnects ungracefully
      will: {
        topic: `backend/${clientId}/lwt`,
        payload: Buffer.from(JSON.stringify({ status: 'offline', clientId })),
        qos: 1,
        retain: true,
      },
    };

    if (username && password) {
      options.username = username;
      options.password = password;
    }

    try {
      this.client = mqtt.connect(brokerUrl, options);

      this.client.on('connect', () => {
        this.isConnected = true;
        this.logger.log('Successfully connected to MQTT Broker!');

        // Re-apply all registered subscriptions on reconnect
        for (const [topic] of this.pendingSubscriptions.entries()) {
          this.client!.subscribe(topic, { qos: 1 }, (err) => {
            if (err) {
              this.logger.error(
                `Failed to subscribe to "${topic}": ${err.message}`,
              );
            } else {
              this.logger.log(`Subscribed to MQTT topic: ${topic}`);
            }
          });
        }

        this.flushOfflineQueue();
      });

      // Route incoming messages to registered handlers
      this.client.on('message', (topic, payload) => {
        void this.routeMessage(topic, payload);
      });

      this.client.on('offline', () => {
        this.isConnected = false;
        this.logger.warn('MQTT Broker is offline. Reconnecting...');
      });

      this.client.on('close', () => {
        this.isConnected = false;
        this.logger.warn('MQTT connection closed.');
      });

      this.client.on('error', (err) => {
        this.isConnected = false;
        this.logger.error(`MQTT Client error: ${err.message}`);
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.logger.error(`Failed to initialize MQTT connection: ${message}`);
    }
  }

  /**
   * Subscribe to an MQTT topic with a message handler.
   * Supports MQTT wildcards: '+' (single level) and '#' (multi level).
   * Handlers are stored and re-applied on reconnection.
   */
  subscribe(topic: string, handler: MqttMessageHandler): void {
    if (!this.pendingSubscriptions.has(topic)) {
      this.pendingSubscriptions.set(topic, []);
    }
    this.pendingSubscriptions.get(topic)!.push(handler);

    if (this.client && this.isConnected) {
      this.client.subscribe(topic, { qos: 1 }, (err) => {
        if (err) {
          this.logger.error(
            `Failed to subscribe to "${topic}": ${err.message}`,
          );
        } else {
          this.logger.log(`Subscribed to MQTT topic: ${topic}`);
        }
      });
    }
    // If not connected yet, the subscription will be applied on the 'connect' event
  }

  /**
   * Routes incoming MQTT messages to all matching registered handlers.
   * Converts MQTT wildcard topics to regex for matching.
   */
  private async routeMessage(topic: string, payload: Buffer): Promise<void> {
    for (const [pattern, handlers] of this.pendingSubscriptions.entries()) {
      if (this.topicMatchesPattern(topic, pattern)) {
        for (const handler of handlers) {
          try {
            await handler(topic, payload);
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            this.logger.error(
              `MQTT message handler error for topic "${topic}": ${msg}`,
            );
          }
        }
      }
    }
  }

  /**
   * Checks whether a concrete MQTT topic matches a wildcard pattern.
   * '+' matches exactly one level, '#' matches zero or more levels.
   */
  private topicMatchesPattern(topic: string, pattern: string): boolean {
    if (pattern === topic) return true;

    let regex = this.regexCache.get(pattern);
    if (!regex) {
      const regexStr = pattern
        .split('/')
        .map((part) => {
          if (part === '#') return '.*';
          if (part === '+') return '[^/]+';
          return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        })
        .join('/');
      regex = new RegExp(`^${regexStr}$`);
      this.regexCache.set(pattern, regex);
    }

    return regex.test(topic);
  }

  private flushOfflineQueue() {
    if (!this.client || !this.isConnected || this.offlineQueue.length === 0) {
      return;
    }

    const pending = this.offlineQueue.splice(0, this.offlineQueue.length);
    for (const item of pending) {
      this.client.publish(item.topic, item.message, item.options, (err) => {
        if (err) {
          this.logger.error(
            `Failed to flush buffered MQTT message to topic "${item.topic}": ${err.message}`,
          );
          if (this.offlineQueue.length < this.offlineQueueMaxSize) {
            this.offlineQueue.push(item);
          }
        } else {
          this.logger.log(
            `Flushed buffered MQTT message to topic "${item.topic}"`,
          );
        }
      });
    }
  }

  async publish(
    topic: string,
    payload: string | Buffer | Record<string, unknown>,
  ): Promise<boolean> {
    let message: string | Buffer;
    if (Buffer.isBuffer(payload)) {
      message = payload;
    } else {
      message = typeof payload === 'string' ? payload : JSON.stringify(payload);
    }

    const publishOptions: mqtt.IClientPublishOptions = { qos: 2 };

    if (!this.client || !this.isConnected) {
      if (this.offlineQueue.length >= this.offlineQueueMaxSize) {
        this.logger.error(
          `Offline MQTT queue full. Dropping message for topic "${topic}".`,
        );
        return false;
      }

      this.offlineQueue.push({ topic, message, options: publishOptions });
      this.logger.warn(
        `MQTT broker offline. Buffered message for topic "${topic}" (${this.offlineQueue.length}/${this.offlineQueueMaxSize}).`,
      );
      return true;
    }

    return new Promise((resolve) => {
      this.client!.publish(topic, message, publishOptions, (err) => {
        if (err) {
          this.logger.error(
            `Failed to publish to topic "${topic}": ${err.message}`,
          );
          if (this.offlineQueue.length < this.offlineQueueMaxSize) {
            this.offlineQueue.push({ topic, message, options: publishOptions });
            this.logger.warn(
              `Message for topic "${topic}" buffered after publish failure.`,
            );
          }
          resolve(false);
        } else {
          this.logger.log(`Published payload successfully to topic "${topic}"`);
          resolve(true);
        }
      });
    });
  }

  onModuleDestroy() {
    if (this.client) {
      this.logger.log('Closing MQTT connection...');
      this.client.end();
    }
  }
}
