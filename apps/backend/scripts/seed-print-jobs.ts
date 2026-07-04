import { Client } from 'pg';

const connectionString =
  process.env.DATABASE_URL ||
  'postgresql://postgres:postgres@localhost:5432/antd_db';

async function main() {
  const client = new Client({ connectionString });
  await client.connect();

  console.log('Ensuring print_jobs table exists...');
  await client.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);

  await client.query(`CREATE TABLE IF NOT EXISTS print_jobs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    order_id uuid NOT NULL,
    job_type varchar(50) NOT NULL,
    status varchar(50) NOT NULL DEFAULT 'queued',
    printer_id varchar(255),
    attempts integer NOT NULL DEFAULT 0,
    last_error varchar(1024),
    payload jsonb NOT NULL,
    created_at timestamp NOT NULL DEFAULT now(),
    updated_at timestamp NOT NULL DEFAULT now()
  )`);

  async function addConstraintIfMissing(
    constraintName: string,
    constraintSql: string,
  ) {
    const existing = await client.query(
      `SELECT 1 FROM pg_constraint WHERE conname = $1 LIMIT 1`,
      [constraintName],
    );

    if (existing.rows.length === 0) {
      await client.query(constraintSql);
    }
  }

  await addConstraintIfMissing(
    'print_jobs_organization_id_organizations_id_fk',
    `ALTER TABLE print_jobs
     ADD CONSTRAINT print_jobs_organization_id_organizations_id_fk
     FOREIGN KEY (organization_id)
     REFERENCES organizations(id)
     ON DELETE cascade`,
  );

  await addConstraintIfMissing(
    'print_jobs_order_id_orders_id_fk',
    `ALTER TABLE print_jobs
     ADD CONSTRAINT print_jobs_order_id_orders_id_fk
     FOREIGN KEY (order_id)
     REFERENCES orders(id)
     ON DELETE cascade`,
  );

  const existingRows = await client.query(
    `SELECT count(*) AS count FROM print_jobs`,
  );
  const rowCount = Number(existingRows.rows[0]?.count || 0);

  if (rowCount > 0) {
    console.log(
      `Skipping seed insert: ${rowCount} print_jobs rows already exist.`,
    );
    await client.end();
    return;
  }

  const orderResult = await client.query(
    `SELECT id, organization_id FROM orders LIMIT 1`,
  );

  if (orderResult.rows.length === 0) {
    console.warn(
      'No orders available to seed print_jobs. Create an order first.',
    );
    await client.end();
    return;
  }

  const { id: orderId, organization_id: organizationId } = orderResult.rows[0];

  const seedJobs = [
    {
      jobType: 'kitchen',
      status: 'queued',
      printerId: 'kitchen-printer-01',
      payload: {
        orderId,
        customerName: 'Seed Customer',
        customerPhone: '+10000000000',
        totalAmount: 1999,
        items: [{ menuItemName: 'Test Pizza', quantity: 1, price: 1999 }],
      },
    },
    {
      jobType: 'receipt',
      status: 'failed',
      printerId: 'receipt-printer-01',
      payload: {
        orderId,
        customerName: 'Seed Customer',
        customerPhone: '+10000000000',
        totalAmount: 1999,
        items: [{ menuItemName: 'Test Pizza', quantity: 1, price: 1999 }],
      },
      lastError: 'Seed failure reason: printer offline',
      attempts: 1,
    },
  ];

  for (const job of seedJobs) {
    await client.query(
      `INSERT INTO print_jobs (organization_id, order_id, job_type, status, printer_id, attempts, last_error, payload, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now(), now())`,
      [
        organizationId,
        orderId,
        job.jobType,
        job.status,
        job.printerId,
        job.attempts ?? 0,
        job.lastError ?? null,
        JSON.stringify(job.payload),
      ],
    );
  }

  console.log('Seeded print_jobs rows successfully.');
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
