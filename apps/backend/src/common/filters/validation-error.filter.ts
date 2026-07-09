import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  BadRequestException,
  Logger,
} from '@nestjs/common';

@Catch(BadRequestException)
export class ValidationErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger('ValidationError');

  catch(exception: BadRequestException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest();
    const response = ctx.getResponse();

    this.logger.error(
      `Validation Error on ${request.url}: ${JSON.stringify(exception.getResponse())}`,
    );

    response.status(400).json(exception.getResponse());
  }
}
