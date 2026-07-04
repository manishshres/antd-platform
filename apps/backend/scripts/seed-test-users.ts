import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { DRIZZLE } from '../src/database/database.module';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../src/database/schema';
import * as bcrypt from 'bcrypt';
import { eq } from 'drizzle-orm';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const db = app.get<NodePgDatabase<typeof schema>>(DRIZZLE);

  console.log('Seeding test data...');

  try {
    // 1. Check if organization exists
    let testOrg;
    const existingOrg = await db.select().from(schema.organizations).where(eq(schema.organizations.slug, 'test-org'));
    if (existingOrg.length > 0) {
      testOrg = existingOrg[0];
      console.log('Found existing test organization:', testOrg.id);
    } else {
      const orgResult = await db.insert(schema.organizations).values({
        name: 'Test Org',
        slug: 'test-org',
        status: 'active',
      }).returning();
      testOrg = orgResult[0];
      console.log('Created test organization:', testOrg.id);
    }

    // Since telnyxAssistantId is in locations (from our earlier schema view), let's create a location for the org
    const existingLoc = await db.select().from(schema.locations).where(eq(schema.locations.organizationId, testOrg.id));
    if (existingLoc.length > 0) {
      console.log('Location already exists for test org');
    } else {
      await db.insert(schema.locations).values({
        organizationId: testOrg.id,
        name: 'Test HQ',
        slug: 'test-hq',
        telnyxAssistantId: 'assistant-5966713f-9eb2-4b68-bdda-22a1fd4820b3', // From user prompt
        status: 'active',
      });
      console.log('Created test location with assistant ID');
    }

    // 2. Create users
    const defaultPassword = 'password123';
    const passwordHash = await bcrypt.hash(defaultPassword, 12);

    const usersToCreate = [
      {
        email: 'sysadmin@test.com',
        firstName: 'Sys',
        lastName: 'Admin',
        role: 'sysadmin',
        organizationId: testOrg.id, // Sysadmins don't strictly need one, but FK requires it in our schema right now
      },
      {
        email: 'admin@test.com',
        firstName: 'Test',
        lastName: 'Admin',
        role: 'admin',
        organizationId: testOrg.id,
      },
      {
        email: 'user@test.com',
        firstName: 'Test',
        lastName: 'User',
        role: 'user',
        organizationId: testOrg.id,
      },
    ];

    for (const userData of usersToCreate) {
      // Check if user exists
      const existing = await db.select().from(schema.users).where(eq(schema.users.email, userData.email));
      if (existing.length > 0) {
        console.log(`User ${userData.email} already exists, skipping.`);
        continue;
      }
      await db.insert(schema.users).values({
        ...userData,
        passwordHash,
      });
      console.log(`Created user: ${userData.email}`);
    }

    console.log('Seeding completed.');
    console.log(`Passwords for all test users: ${defaultPassword}`);
  } catch (error) {
    console.error('Error during seeding:', error);
  } finally {
    await app.close();
  }
}

bootstrap();
