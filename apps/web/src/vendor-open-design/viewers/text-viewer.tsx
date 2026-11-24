// SPDX-License-Identifier: Apache-2.0. Modified by Cairn from nexu-io/open-design@07258801 apps/web/src/components/FileViewer.tsx
import { type ReactNode, useMemo } from 'react';
import { CodeWithLines } from './code-with-lines.js';
import { fileExtOf } from './file-kind.js';

const LANG_FOR_EXT: Record<string, string | undefined> = {
  txt: undefined,
  rst: undefined,
  adoc: undefined,
  tsv: undefined,
  csv: undefined,
  diff: undefined,
  patch: undefined,
  htm: 'html',
  svg: 'xml',
  h: 'c',
  hpp: 'cpp',
  m: 'objective-c',
  mm: 'objective-cpp',
  mjs: 'javascript',
  cjs: 'javascript',
};

export function codeLangFor(name: string): string | undefined {
  const ext = fileExtOf(name);
  if (ext === '') return undefined;
  return Object.hasOwn(LANG_FOR_EXT, ext) ? LANG_FOR_EXT[ext] : ext;
}

export function isDiffFile(name: string): boolean {
  const ext = fileExtOf(name);
  return ext === 'diff' || ext === 'patch';
}

export function TextViewer({
  name,
  text,
  lineMark,
}: {
  name: string;
  text: string;
  lineMark?: ((line: number) => ReactNode) | undefined;
}) {
  const displayText = useMemo(() => formatJsonFileTextForDisplay(name, text), [name, text]);
  return (
    <CodeWithLines
      text={displayText}
      lang={codeLangFor(name)}
      diff={isDiffFile(name)}
      lineMark={lineMark}
    />
  );
}

export function formatJsonFileTextForDisplay(name: string, text: string): string {
  if (!isJsonFile(name)) return text;
  try {
    if (hasPrecisionSensitiveJsonNumberText(text)) return text;
    const parsed = JSON.parse(text) as unknown;
    if (hasUnsafeJsonNumber(parsed)) return text;
    return JSON.stringify(parsed, null, 2);
  } catch {
    return text;
  }
}

function hasPrecisionSensitiveJsonNumberText(text: string): boolean {
  let inString = false;
  let escaped = false;
  const numberTokenPattern = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
  for (let i = 0; i < text.length; ) {
    const char = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      i += 1;
      continue;
    }
    if (char === '"') {
      inString = true;
      i += 1;
      continue;
    }
    numberTokenPattern.lastIndex = i;
    const match = numberTokenPattern.exec(text);
    if (!match) {
      i += 1;
      continue;
    }
    const token = match[0];
    if (isSignedNegativeZeroJsonNumberToken(token)) return true;
    if (/[.eE]/.test(token) && isPrecisionSensitiveJsonNumberToken(token)) return true;
    i = numberTokenPattern.lastIndex;
  }
  return false;
}

function isSignedNegativeZeroJsonNumberToken(token: string): boolean {
  return /^-0(?:\.0+)?(?:[eE][+-]?\d+)?$/.test(token);
}

function isPrecisionSensitiveJsonNumberToken(token: string): boolean {
  const parsed = Number(token);
  if (!Number.isFinite(parsed)) return true;
  const rendered = JSON.stringify(parsed);
  if (!rendered) return true;
  const originalValue = parseJsonNumberTokenAsDecimal(token);
  const renderedValue = parseJsonNumberTokenAsDecimal(rendered);
  return (
    !originalValue ||
    !renderedValue ||
    originalValue.coefficient !== renderedValue.coefficient ||
    originalValue.exponent !== renderedValue.exponent
  );
}

function parseJsonNumberTokenAsDecimal(
  token: string,
): { coefficient: bigint; exponent: number } | null {
  const match = /^(-)?(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(token);
  if (!match) return null;
  const [, sign, integerPart, fractionPart = '', exponentPart = '0'] = match;
  const coefficient = BigInt(`${sign ?? ''}${integerPart}${fractionPart}`);
  const exponent = Number(exponentPart) - fractionPart.length;
  return normalizeDecimalParts(coefficient, exponent);
}

function normalizeDecimalParts(
  coefficient: bigint,
  exponent: number,
): { coefficient: bigint; exponent: number } {
  if (coefficient === 0n) return { coefficient: 0n, exponent: 0 };
  let normalizedCoefficient = coefficient;
  let normalizedExponent = exponent;
  while (normalizedCoefficient % 10n === 0n) {
    normalizedCoefficient /= 10n;
    normalizedExponent += 1;
  }
  return { coefficient: normalizedCoefficient, exponent: normalizedExponent };
}

function hasUnsafeJsonNumber(value: unknown): boolean {
  if (typeof value === 'number') {
    return !Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value));
  }
  if (Array.isArray(value)) return value.some(hasUnsafeJsonNumber);
  if (value && typeof value === 'object') return Object.values(value).some(hasUnsafeJsonNumber);
  return false;
}

function isJsonFile(name: string): boolean {
  return fileExtOf(name) === 'json';
}
