import './tracing'; // Must be imported first
import './instrument';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import { RequestHandler } from 'express';
import { GlobalExceptionFilter } from './common/filters/http-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { Logger } from 'nestjs-pino';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    rawBody: true,
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));

  const logger = app.get(Logger);

  const configService = app.get(ConfigService);
  const nodeEnv = configService.get<string>('NODE_ENV', 'development');
  const frontendUrl = configService.get<string>(
    'FRONTEND_URL',
    'http://localhost:3000',
  );

  // Secure HTTP headers - safely cast helmet default export
  const helmetFn = helmet as unknown as () => RequestHandler;
  app.use(helmetFn());

  // Global exception filter — consistent error shape, never leaks stack traces
  app.useGlobalFilters(new GlobalExceptionFilter());

  // Global logging interceptor
  app.useGlobalInterceptors(new LoggingInterceptor());

  // Set global route prefix
  app.setGlobalPrefix('api');

  // Enable API versioning (/api/v1, /api/v2)
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });

  // Enable global validation pipe
  const {
    ValidationErrorFilter,
  } = require('./common/filters/validation-error.filter');
  app.useGlobalFilters(new ValidationErrorFilter());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  // Enable CORS — restrict to known frontend origin in production
  app.enableCors({
    origin:
      nodeEnv === 'production'
        ? frontendUrl
        : (
            origin: string | undefined,
            callback: (err: Error | null, allow?: boolean) => void,
          ) => {
            // Allow all origins in development to prevent local port mismatch errors
            callback(null, true);
          },
    credentials: true,
  });

  // Configure Swagger API Docs — kept out of production to avoid exposing the
  // full API surface publicly.
  if (nodeEnv !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('Call Center AI Backend API')
      .setDescription('The API documentation for the SaaS backend')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
  }

  const port = configService.get<number>('PORT', 4000);
  await app.listen(port);
  logger.log(`NestJS Backend running on http://localhost:${port}/api/v1`);
  if (nodeEnv !== 'production') {
    logger.log(`Swagger Docs available at http://localhost:${port}/api/docs`);
  }
  logger.log(`Environment: ${nodeEnv}`);
}
void bootstrap();
