import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryAddress } from './process-memory.mjs';
import { requestToken } from './token-scope-probe.mjs';

test('memory probe selects a readable mapped address and never zero', () => {
  assert.equal(
    memoryAddress('0000-1000 r--p 0 0 0\n1000-2000 ---p 0 0 0\n3000-4000 rw-p 0 0 0'),
    0x3000,
  );
  assert.equal(memoryAddress('1000-2000 ---p 0 0 0'), null);
});
test('client rejects relative sockets before connecting', async () => {
  await assert.rejects(requestToken('relative.sock'), /absolute/i);
});
