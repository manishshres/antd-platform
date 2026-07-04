import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { UsersService } from '../users/users.service';
import * as bcrypt from 'bcrypt';
import { ConfigService } from '@nestjs/config';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const usersService = app.get(UsersService);
  const configService = app.get(ConfigService);

  const email = configService.get<string>(
    'PLATFORM_ADMIN_EMAIL',
    'admin@manish.dev',
  );
  const password = configService.get<string>(
    'PLATFORM_ADMIN_PASSWORD',
    'admin123',
  );

  const existing = await usersService.findOneByEmail(email);
  if (existing) {
    console.log(`Platform admin ${email} already exists.`);
  } else {
    const passwordHash = await bcrypt.hash(password, 12);
    await usersService.create(
      email,
      passwordHash,
      'platform_admin',
      undefined,
      'Platform',
      'Admin',
    );
    console.log(`Platform admin ${email} created successfully.`);
  }

  await app.close();
}

bootstrap().catch((err) => {
  console.error('Error seeding platform admin:', err);
  process.exit(1);
});
