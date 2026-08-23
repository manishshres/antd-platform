#!/usr/bin/env node
/**
 * Bump the platform version in lockstep across the monorepo and commit it.
 *
 * Usage:
 *   npm run release            # patch bump: 0.1.0 -> 0.1.1
 *   npm run release minor      # 0.1.0 -> 0.2.0
 *   npm run release major      # 0.1.0 -> 1.0.0
 *   npm run release 1.2.3      # set an explicit version
 *   npm run release -- --dry-run   (any of the above; prints, changes nothing)
 *
 * Writes the same version to the root, backend, frontend, and pos package.json,
 * refreshes the workspace lockfile, then makes a `release: vX.Y.Z` commit
 * containing only those files, tagged `vX.Y.Z`.
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

const PKG_PATHS = [
  'package.json',
  'apps/backend/package.json',
  'apps/frontend/package.json',
  'apps/pos/package.json',
].map((p) => join(root, p));

// The Expo manifest, not package.json, is what the installed Android app reports. Keeping
// it out of the release meant every tablet build claimed the same version — and Android
// refuses to treat an APK with an unchanged versionCode as an update, so a rebuilt POS
// could silently fail to install over the old one.
const POS_APP_JSON = join(root, 'apps/pos/app.json');

const args = process.argv.slice(2).filter((a) => a !== '--');
const dryRun = args.includes('--dry-run');
const bumpArg = args.find((a) => a !== '--dry-run') ?? 'patch';

const readPkg = (path) => JSON.parse(readFileSync(path, 'utf8'));

// The backend package is the canonical current version (all three are kept in
// lockstep after the first release; before that, backend wins).
const current = readPkg(PKG_PATHS[1]).version;

function nextVersion(cur, bump) {
  if (/^\d+\.\d+\.\d+$/.test(bump)) return bump;
  const [maj, min, pat] = cur.split('.').map(Number);
  switch (bump) {
    case 'major':
      return `${maj + 1}.0.0`;
    case 'minor':
      return `${maj}.${min + 1}.0`;
    case 'patch':
      return `${maj}.${min}.${pat + 1}`;
    default:
      console.error(
        `Unknown bump "${bump}" — use patch, minor, major, or an explicit x.y.z`,
      );
      process.exit(1);
  }
}

const next = nextVersion(current, bumpArg);
const tag = `v${next}`;

// Refuse to overwrite an existing release tag.
const existingTag = execSync(`git tag -l "${tag}"`, { cwd: root })
  .toString()
  .trim();
if (existingTag) {
  console.error(`Tag ${tag} already exists — bump differently or delete it.`);
  process.exit(1);
}

console.log(`Releasing ${current} -> ${next}${dryRun ? ' (dry run)' : ''}`);

if (dryRun) {
  console.log('Would update:');
  for (const p of PKG_PATHS) console.log(`  ${p}`);
  console.log(`  ${POS_APP_JSON} (version + android.versionCode)`);
  console.log(`Would commit "release: ${tag}" and tag ${tag}`);
  process.exit(0);
}

for (const path of PKG_PATHS) {
  const pkg = readPkg(path);
  pkg.version = next;
  writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`);
  console.log(`  ${path} -> ${next}`);
}

// Expo manifest: the version string tracks the release, and versionCode is a monotonic
// integer Android uses to decide what counts as an upgrade. It only ever increments —
// reusing one means the APK will not install over the copy already on the tablet.
{
  const app = readPkg(POS_APP_JSON);
  app.expo.version = next;
  app.expo.android = app.expo.android ?? {};
  app.expo.android.versionCode = (app.expo.android.versionCode ?? 0) + 1;
  writeFileSync(POS_APP_JSON, `${JSON.stringify(app, null, 2)}\n`);
  console.log(
    `  ${POS_APP_JSON} -> ${next} (versionCode ${app.expo.android.versionCode})`,
  );
}

// Sync the workspace lockfile's own version fields without touching deps.
execSync('npm install --package-lock-only --ignore-scripts', {
  cwd: root,
  stdio: 'inherit',
});

// Commit only the release files so unrelated working-tree changes stay put.
const files = [
  'package.json',
  'package-lock.json',
  'apps/backend/package.json',
  'apps/frontend/package.json',
  'apps/pos/package.json',
  'apps/pos/app.json',
];
execSync(`git add ${files.join(' ')}`, { cwd: root });
execSync(`git commit -m "release: ${tag}" -- ${files.join(' ')}`, {
  cwd: root,
  stdio: 'inherit',
});
execSync(`git tag ${tag}`, { cwd: root });

console.log(`\nDone: committed and tagged ${tag}.`);
console.log('Push with: git push && git push --tags');
