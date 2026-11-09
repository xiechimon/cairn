import { defineConfig } from 'vitest/config';
import { admitTestRun } from '../../scripts/test-admission.mjs';

await admitTestRun();

export default defineConfig({});
