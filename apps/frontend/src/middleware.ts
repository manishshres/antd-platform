// Next.js edge middleware entry point. Logic lives in proxy.ts to keep this file
// thin — Next.js only picks up middleware from a file literally named middleware.ts
// at the src root; proxy.ts alone is never invoked by the framework.
export { proxy as middleware, config } from './proxy';
