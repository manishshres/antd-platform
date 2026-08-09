// Root postinstall. Runs on every `npm install`, including CI and platform
// builds (Vercel, Render) where devDependencies may be absent or pruned — so
// every dev-only step is guarded. Only the shared-types build is mandatory:
// both apps import it.
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

// Check the directory rather than require.resolve: husky v9 has an "exports"
// map that hides package.json, so resolving it throws even when installed.
function isInstalled(pkg) {
  return existsSync(new URL(`../node_modules/${pkg}`, import.meta.url));
}

function run(args) {
  execFileSync(npm, args, { stdio: 'inherit' });
}

// patch-package only patches the Expo POS app's native printer module.
if (isInstalled('patch-package')) {
  run(['exec', '--no', '--', 'patch-package']);
} else {
  console.log('postinstall: patch-package not installed — skipping patches.');
}

run(['run', 'build', '--workspace', '@platform/shared-types']);

// husky needs its package and a .git directory; neither exists in a Docker build.
if (isInstalled('husky') && existsSync('.git')) {
  run(['exec', '--no', '--', 'husky', 'install']);
} else {
  console.log('postinstall: skipping husky install.');
}
