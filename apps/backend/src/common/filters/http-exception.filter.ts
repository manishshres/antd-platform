import {
  ExceptionFilter,
  Catch,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import { Request, Response } from 'express';
import { SentryExceptionCaptured } from '@sentry/nestjs';
import * as Sentry from '@sentry/node';

interface ErrorResponse {
  statusCode: number;
  message: string | string[];
  error: string;
  timestamp: string;
  path: string;
}

/**
 * GlobalExceptionFilter — normalizes ALL errors to a consistent shape:
 *   { statusCode, message, error, timestamp, path }
 *
 * Never leaks stack traces to the client. Logs errors with context on the server side.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  @SentryExceptionCaptured()
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status: number;
    let message: string | string[];
    let error: string;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
        error = exception.message;
      } else if (
        typeof exceptionResponse === 'object' &&
        exceptionResponse !== null
      ) {
        const resp = exceptionResponse as Record<string, unknown>;
        message = (resp.message as string | string[]) ?? exception.message;
        error = (resp.error as string) ?? HttpStatus[status] ?? 'Error';
      } else {
        message = exception.message;
        error = HttpStatus[status] ?? 'Error';
      }

      // Explicitly send 400 Bad Request errors to Sentry
      if (status === HttpStatus.BAD_REQUEST) {
        Sentry.captureException(exception, {
          level: 'warning',
          tags: { type: 'bad_request' },
          extra: {
            path: request.url,
            method: request.method,
            body: request.body,
          },
        });
      }
    } else {
      // Unexpected/unhandled errors — log the full stack, never expose to client
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      message = 'An unexpected error occurred. Please try again later.';
      error = 'Internal Server Error';

      const stack = exception instanceof Error ? exception.stack : undefined;
      const msg =
        exception instanceof Error ? exception.message : String(exception);
      this.logger.error(
        `Unhandled exception: ${msg} — ${request.method} ${request.url}`,
        stack,
      );
    }

    const body: ErrorResponse = {
      statusCode: status,
      message,
      error,
      timestamp: new Date().toISOString(),
      path: request.url,
    };

    response.status(status).json(body);
  }
}
