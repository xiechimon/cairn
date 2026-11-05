import { packagingTestsRequested, requirePackagingPlatform } from './packaging-platform.mjs';

if (!packagingTestsRequested(process.env.CAIRN_EVAL_PACKAGING_TESTS)) {
  throw new Error('CAIRN_EVAL_PACKAGING_TESTS=1 is required for packaging proof');
}
await requirePackagingPlatform();
process.stdout.write('Production packaging namespace preflight passed\n');
