import { startStubLlm } from '../../../integration/test/stub-llm.js';

const CORRECT_SLUG =
  'export function slugify(value) {\n  const parts = value.toLowerCase().split(/[^a-z0-9]+/);\n  return parts.filter((part) => part !== "").join("-");\n}\n';

const responses =
  process.argv[2] === 'snoop'
    ? [
        { toolCall: { name: 'read', arguments: { path: '/etc/hostname' } } },
        {
          toolCall: {
            name: 'write',
            arguments: { path: 'lib/slug.mjs', content: CORRECT_SLUG },
          },
        },
        { content: 'Implemented slugify in lib/slug.mjs.' },
      ]
    : [
        {
          toolCall: {
            name: 'write',
            arguments: { path: 'lib/slug.mjs', content: CORRECT_SLUG },
          },
        },
        { content: 'Implemented slugify in lib/slug.mjs.' },
        { content: 'Plan: implement slugify in lib/slug.mjs using split on non-alphanumerics and join with hyphens; cover trimming of empty parts for leading/trailing separators.' },
        {
          toolCall: {
            name: 'write',
            arguments: { path: 'lib/slug.mjs', content: CORRECT_SLUG },
          },
        },
        { content: 'Implemented slugify in lib/slug.mjs.' },
      ];

const stub = await startStubLlm(responses);

console.log(stub.url);
setTimeout(() => process.exit(0), 120_000);
