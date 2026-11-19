import { describe, expect, test } from 'vitest';
import { sanitizeToolParameters } from '../src/index.js';

describe('sanitizeToolParameters', () => {
  test('undefined and null inputSchema stay absent', () => {
    expect(sanitizeToolParameters(undefined)).toBeUndefined();
    expect(sanitizeToolParameters(null)).toBeUndefined();
  });

  test('keeps the vocabulary keys and drops constraint keywords', () => {
    expect(
      sanitizeToolParameters({
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        title: 'SendArgs',
        additionalProperties: false,
        required: ['to', 'subject'],
        properties: {
          to: { type: 'string', format: 'email', maxLength: 254, examples: ['a@b.c'] },
          subject: { type: 'string', minLength: 1, pattern: '^[^\\r\\n]+$' },
          body: { type: 'string', default: '' },
          count: { type: 'integer', minimum: 1, maximum: 50 },
          verbose: { type: 'boolean', default: false },
        },
      }),
    ).toEqual({
      type: 'object',
      required: ['to', 'subject'],
      properties: {
        to: { type: 'string' },
        subject: { type: 'string' },
        body: { type: 'string' },
        count: { type: 'integer' },
        verbose: { type: 'boolean' },
      },
    });
  });

  test('descriptions survive at every level', () => {
    expect(
      sanitizeToolParameters({
        type: 'object',
        description: 'Root.',
        properties: { q: { type: 'string', description: 'Query.' } },
      }),
    ).toEqual({
      type: 'object',
      description: 'Root.',
      properties: { q: { type: 'string', description: 'Query.' } },
    });
  });

  test('integer is kept, not rewritten', () => {
    expect(
      sanitizeToolParameters({ type: 'object', properties: { max: { type: 'integer' } } }),
    ).toEqual({ type: 'object', properties: { max: { type: 'integer' } } });
  });

  test('type unions pick the first non-null usable member', () => {
    expect(
      sanitizeToolParameters({
        type: 'object',
        properties: {
          a: { type: ['string', 'null'] },
          b: { type: ['null', 'integer'] },
          c: { type: ['null'] },
        },
      }),
    ).toEqual({
      type: 'object',
      properties: { a: { type: 'string' }, b: { type: 'integer' }, c: { type: 'null' } },
    });
  });

  test('composites take their first object branch', () => {
    expect(
      sanitizeToolParameters({
        type: 'object',
        properties: {
          filter: { anyOf: [{ type: 'string' }, { type: 'integer' }] },
          merged: { allOf: [{ type: 'object', properties: { x: { type: 'number' } } }] },
        },
      }),
    ).toEqual({
      type: 'object',
      properties: {
        filter: { type: 'string' },
        merged: { type: 'object', properties: { x: { type: 'number' } } },
      },
    });
  });

  test('missing type infers from properties or items, else string', () => {
    expect(
      sanitizeToolParameters({
        type: 'object',
        properties: {
          byProps: { properties: { a: { type: 'string' } } },
          byItems: { items: { type: 'number' } },
          byEnum: { enum: ['a', 'b'] },
          byRef: { $ref: '#/$defs/Thing', $defs: { Thing: { type: 'string' } } },
        },
      }),
    ).toEqual({
      type: 'object',
      properties: {
        byProps: { type: 'object', properties: { a: { type: 'string' } } },
        byItems: { type: 'array', items: { type: 'number' } },
        byEnum: { type: 'string' },
        byRef: { type: 'string' },
      },
    });
  });

  test('objects without declared properties stay free-form, arrays always carry items', () => {
    expect(
      sanitizeToolParameters({
        type: 'object',
        properties: {
          bare: { type: 'object' },
          record: { type: 'object', additionalProperties: { type: 'string' } },
          empty: { type: 'object', properties: {} },
          list: { type: 'array' },
        },
      }),
    ).toEqual({
      type: 'object',
      properties: {
        bare: { type: 'object' },
        record: { type: 'object' },
        empty: { type: 'object', properties: {} },
        list: { type: 'array', items: { type: 'string' } },
      },
    });
  });

  test('a property literally named __proto__ stays an own key', () => {
    const out = sanitizeToolParameters(
      JSON.parse(
        '{"type":"object","properties":{"__proto__":{"type":"string"},"safe":{"type":"number"}}}',
      ) as unknown,
    );
    const props = out?.properties as Record<string, unknown>;
    expect(Object.hasOwn(props, '__proto__')).toBe(true);
    expect(Reflect.get(props, '__proto__')).toEqual({ type: 'string' });
    expect(props.safe).toEqual({ type: 'number' });
  });

  test('non-object nodes and tuple items degrade to a string leaf', () => {
    expect(
      sanitizeToolParameters({
        type: 'object',
        properties: { bool: true, tuple: { type: 'array', items: [{ type: 'string' }] } },
      }),
    ).toEqual({
      type: 'object',
      properties: {
        bool: { type: 'string' },
        tuple: { type: 'array', items: { type: 'string' } },
      },
    });
  });

  test('a non-object root collapses to a bare object schema', () => {
    expect(sanitizeToolParameters({ type: 'string' })).toEqual({ type: 'object' });
    expect(sanitizeToolParameters('nonsense')).toEqual({ type: 'object' });
    expect(sanitizeToolParameters(42)).toEqual({ type: 'object' });
  });

  test('required keeps only string entries', () => {
    expect(
      sanitizeToolParameters({
        type: 'object',
        required: ['a', 1, null],
        properties: { a: { type: 'string' } },
      }),
    ).toEqual({
      type: 'object',
      required: ['a'],
      properties: { a: { type: 'string' } },
    });
  });
});
