import * as Sentry from '@sentry/nestjs';
import * as dotenv from 'dotenv';

// Load environment variables so we can access SENTRY_DSN
dotenv.config();

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    tracesSampleRate: 1.0,
    dataCollection: {
      // userInfo: false,
      // httpBodies: [],
    },
  });
}
