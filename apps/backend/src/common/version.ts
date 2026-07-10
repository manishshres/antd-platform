import { readFileSync } from 'fs';
import { join } from 'path';

let cached: string | undefined;

/**
 * App version from package.json, read once at first use. Uses process.cwd()
 * because both `nest start` and `node dist/main` run from the backend root.
 */
export function getAppVersion(): string {
  if (!cached) {
    try {
      const pkg = JSON.parse(
        readFileSync(join(process.cwd(), 'package.json'), 'utf8'),
      ) as { version?: string };
      cached = pkg.version ?? '0.0.0';
    } catch {
      cached = '0.0.0';
    }
  }
  return cached;
}
