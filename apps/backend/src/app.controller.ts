import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { Public } from './common/decorators/public.decorator';

@Public()
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  // Served at /api/v1/hello. It cannot sit on the controller root: `main.ts` excludes
  // GET / from the global prefix so RootController can answer the bare domain, and that
  // exclusion matches any GET route resolving to '/' — including this one.
  @Get('hello')
  getHello(): string {
    return this.appService.getHello();
  }
}
