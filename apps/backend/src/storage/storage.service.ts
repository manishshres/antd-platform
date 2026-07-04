import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  DeleteObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Upload } from '@aws-sdk/lib-storage';

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly s3Client: S3Client;
  private readonly bucket: string;

  constructor(private readonly configService: ConfigService) {
    const endpoint = this.configService.get<string>('S3_ENDPOINT');
    const region = this.configService.get<string>('S3_REGION', 'us-east-1');
    const accessKeyId = this.configService.get<string>('AWS_ACCESS_KEY_ID');
    const secretAccessKey = this.configService.get<string>(
      'AWS_SECRET_ACCESS_KEY',
    );
    this.bucket = this.configService.get<string>(
      'S3_BUCKET',
      'recordings-bucket',
    );

    if (accessKeyId && secretAccessKey) {
      this.s3Client = new S3Client({
        region,
        endpoint, // e.g. https://<account_id>.r2.cloudflarestorage.com
        credentials: {
          accessKeyId,
          secretAccessKey,
        },
        forcePathStyle: true, // required for many S3-compatible providers
      });
      this.logger.log(`Initialized S3Client for bucket: ${this.bucket}`);
    } else {
      this.logger.warn(
        'AWS credentials not found, StorageService is running in mock mode.',
      );
      this.s3Client = {} as S3Client;
    }
  }

  async uploadStream(
    key: string,
    stream: NodeJS.ReadableStream,
    contentType: string,
  ): Promise<string> {
    if (!this.s3Client.send) {
      this.logger.warn(`Mock upload for key: ${key}`);
      return key;
    }

    try {
      const upload = new Upload({
        client: this.s3Client,
        params: {
          Bucket: this.bucket,
          Key: key,
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          Body: stream as any,
          ContentType: contentType,
        },
      });

      await upload.done();
      this.logger.log(`Successfully uploaded object to S3: ${key}`);
      return key;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to upload to S3: ${msg}`);
      throw err;
    }
  }

  async getSignedUrl(key: string, expiresIn = 3600): Promise<string> {
    if (!this.s3Client.send) {
      return `http://mock-s3-url.local/${key}`;
    }

    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });
      const url = await getSignedUrl(this.s3Client, command, { expiresIn });
      return url;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to generate signed URL: ${msg}`);
      throw err;
    }
  }

  async deleteObject(key: string): Promise<void> {
    if (!this.s3Client.send) {
      this.logger.warn(`Mock delete for key: ${key}`);
      return;
    }

    try {
      const command = new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });
      await this.s3Client.send(command);
      this.logger.log(`Successfully deleted object: ${key}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to delete object from S3: ${msg}`);
      throw err;
    }
  }
}
