import { execFileSync } from 'node:child_process';
import { expect, test } from 'vitest';
import { openUserControlPty } from '../src/computer/control-pty.js';
import { openReadOnlyView } from '../src/computer/screen-provider.js';
import { ReadOnlyViewGate } from '../src/computer/view-input.js';

const hasPython = (() => {
  try {
    execFileSync('python3', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function primedGate(): ReadOnlyViewGate {
  const gate = new ReadOnlyViewGate();
  expect(gate.accept(Buffer.from('RFB 003.008\n')).toString('latin1')).toBe('RFB 003.008\n');
  expect(gate.accept(Buffer.from([1]))).toEqual(Buffer.from([1]));
  expect(gate.accept(Buffer.from([1]))).toEqual(Buffer.from([1]));
  return gate;
}

test('a read-only view forwards the RFB handshake before filtering messages', () => {
  const gate = new ReadOnlyViewGate();
  expect(gate.accept(Buffer.from('RFB 003.008\n')).toString('latin1')).toBe('RFB 003.008\n');
  expect(gate.accept(Buffer.from([1 /* None */]))).toEqual(Buffer.from([1]));
  expect(gate.accept(Buffer.from([1 /* shared */]))).toEqual(Buffer.from([1]));
});

test('a read-only view forwards framebuffer requests and drops keys, pointers and pasted text', () => {
  const gate = primedGate();
  const pointer = Buffer.from([5, 1, 0, 10, 0, 20]);
  const key = Buffer.from([4, 1, 0, 0, 0, 0, 0, 65]);
  const request = Buffer.from([3, 1, 0, 0, 0, 0, 0, 100, 0, 80]);
  expect(gate.accept(pointer)).toEqual(Buffer.alloc(0));
  expect(gate.accept(key)).toEqual(Buffer.alloc(0));
  expect(gate.accept(Buffer.concat([pointer, request]))).toEqual(request);
  const view = openReadOnlyView();
  view.stream.write(Buffer.from('RFB 003.008\n'));
  view.stream.write(Buffer.from([1]));
  view.stream.write(Buffer.from([1]));
  view.stream.write(pointer);
  view.stream.write(request.subarray(0, 4));
  view.stream.write(request.subarray(4));
  expect(view.accepted).toEqual([
    Buffer.from('RFB 003.008\n'),
    Buffer.from([1]),
    Buffer.from([1]),
    request,
  ]);
  expect(() => view.stream.write(Buffer.from([6, 0, 0, 0, 0xff, 0xff, 0xff, 0xff]))).not.toThrow();
  view.close();
});

test('an unknown view message is refused instead of being forwarded', () => {
  const gate = primedGate();
  expect(() => gate.accept(Buffer.from([9, 0]))).toThrow('malicious computer view input');
});

test.skipIf(!hasPython || process.platform === 'win32')(
  'a control terminal starts a shell and the lease abort kills it',
  async () => {
    const controller = new AbortController();
    const pty = openUserControlPty(controller.signal);
    const shellPid = await pty.shellPid;
    pty.stream.write('echo READY\n');
    const output = await new Promise<string>((resolve, reject) => {
      let text = '';
      const timer = setTimeout(() => reject(new Error('control pty produced no output')), 3000);
      pty.stream.on('data', (chunk: Buffer) => {
        text += chunk.toString('utf8');
        if (text.includes('READY')) {
          clearTimeout(timer);
          resolve(text);
        }
      });
    });
    expect(output).toContain('READY');
    expect(alive(shellPid)).toBe(true);
    controller.abort();
    const deadline = Date.now() + 2000;
    while (alive(shellPid) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(alive(shellPid)).toBe(false);
  },
);
