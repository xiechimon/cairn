// esbuild single-file output: banner createRequire must not be redeclared here.
import { createRequire as createManifestRequire } from 'node:module';

const requireManifest = createManifestRequire(import.meta.url);
export const DAEMON_VERSION: string = (requireManifest('../package.json') as { version: string })
  .version;
