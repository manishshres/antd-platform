import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../src/database/schema';
import * as dotenv from 'dotenv';
import { resolve } from 'path';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';

dotenv.config({ path: resolve(__dirname, '../.env') });

async function seed() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is missing in environment variables');
  }

  const pool = new Pool({
    connectionString,
    ssl: connectionString.includes('sslmode=require')
      ? { rejectUnauthorized: false }
      : false,
  });

  const db = drizzle(pool, { schema });

  const locs = await db
    .select()
    .from(schema.locations)
    .where(eq(schema.locations.slug, 'makalu-main'))
    .limit(1);

  if (!locs.length) {
    console.log('Location not found');
    process.exit(1);
  }

  const loc = locs[0];
  console.log('Seeding call logs for location:', loc.name);

  // Generate 3 dummy calls
  const callsData = [
    {
      callSessionId: randomUUID(),
      fromNumber: '+12155551234',
      toNumber: loc.phoneNumber || '+18706859294',
      durationMs: 125000,
      transcript: 'Customer: I would like to order a chicken tikka masala. Agent: Sure, what spice level? Customer: Medium.',
      aiSummary: 'Customer ordered a medium spicy chicken tikka masala.',
      sentiment: 'positive',
      callOutcome: 'Order Placed',
      tags: ['order', 'curry'],
      status: 'completed',
    },
    {
      callSessionId: randomUUID(),
      fromNumber: '+12155555678',
      toNumber: loc.phoneNumber || '+18706859294',
      durationMs: 45000,
      transcript: 'Customer: What are your hours today? Agent: We are open until 10 PM. Customer: Thanks.',
      aiSummary: 'Customer inquired about store hours.',
      sentiment: 'neutral',
      callOutcome: 'Information Provided',
      tags: ['inquiry', 'hours'],
      status: 'completed',
    },
    {
      callSessionId: randomUUID(),
      fromNumber: '+12155559999',
      toNumber: loc.phoneNumber || '+18706859294',
      durationMs: 0,
      transcript: '',
      aiSummary: '',
      sentiment: '',
      callOutcome: 'Missed Call',
      tags: [],
      status: 'missed',
    }
  ];

  for (const call of callsData) {
    const startedAt = new Date(Date.now() - Math.floor(Math.random() * 86400000));
    
    // Insert recording
    await db.insert(schema.recordings).values({
      organizationId: loc.organizationId,
      locationId: loc.id,
      callSessionId: call.callSessionId,
      fromNumber: call.fromNumber,
      toNumber: call.toNumber,
      durationMs: call.durationMs,
      transcript: call.transcript,
      aiSummary: call.aiSummary,
      sentiment: call.sentiment,
      callOutcome: call.callOutcome,
      tags: call.tags,
      status: call.status,
      createdAt: startedAt,
      updatedAt: startedAt,
    }).onConflictDoNothing();

    // Insert conversation if transcript exists
    if (call.transcript) {
      await db.insert(schema.conversations).values({
        organizationId: loc.organizationId,
        locationId: loc.id,
        callSessionId: call.callSessionId,
        messages: [
          {
            role: 'user',
            text: call.transcript.split('Agent:')[0].replace('Customer: ', '').trim(),
            sentAt: startedAt.toISOString()
          },
          {
            role: 'agent',
            text: call.transcript.split('Agent:')[1]?.split('Customer:')[0].trim() || '',
            sentAt: new Date(startedAt.getTime() + 2000).toISOString()
          }
        ],
        createdAt: startedAt,
        updatedAt: startedAt,
      }).onConflictDoNothing();
    }
  }

  // Set the webhook API key for the organization so incoming Webhooks will work properly.
  const hashedApiKey = '7f83b1657ff1fc53b92dc18148a1d65df12f68bc762b3226dbd5b8396030c25a'; // Hash for "makalu-api-key"
  await db
    .update(schema.organizations)
    .set({ webhookApiKey: hashedApiKey })
    .where(eq(schema.organizations.id, loc.organizationId));
    
  console.log('Seeded calls and webhook API key successfully.');
  process.exit(0);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
