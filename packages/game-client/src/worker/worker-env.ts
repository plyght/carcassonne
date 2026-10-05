// Import FIRST in a Next.js worker entry. The app's env plugin (varlock) injects an
// init block into app entry modules that needs `window`; it is skipped when this
// flag is set. Workers never read app env vars, so skipping it is safe.
(globalThis as { __varlockBuildInit?: boolean }).__varlockBuildInit = true;

export {};
