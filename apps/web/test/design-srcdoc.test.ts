import { expect, test } from 'vitest';
import { designSrcdoc } from '../src/board/design/srcdoc.js';

test('the sandbox preview delivers its content policy before artifact markup', () => {
  const meta = `<meta http-equiv="Content-Security-Policy" content="base-uri 'none'; object-src 'none'">`;
  const head = '<!-- Example <head> --><!doctype html><html lang="en"><head data-label="A > B">';
  const script = '<script src="https://assets.example.test/pricing.js"></script>';
  const prefix = head + meta + script;

  expect(designSrcdoc(`${head}${script}</head><body>Pricing</body>`).slice(0, prefix.length)).toBe(
    prefix,
  );
  expect(designSrcdoc('<h1>Pricing</h1>').slice(0, meta.length)).toBe(meta);
});
