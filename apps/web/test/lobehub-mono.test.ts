import { createHash } from 'node:crypto';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  AnthropicMark,
  AntigravityMark,
  ClaudeCodeMark,
  ClaudeMark,
  DevinMark,
  DoubaoMark,
  GeminiMark,
  GrokMark,
  OpenAIMark,
} from '../src/components/brand-marks.js';
import { LOBEHUB_MONO } from '../src/icons/lobehub-mono.js';

const upstream = {
  'github-copilot': 'd376ec2a732032a501789b7f4def44b795d37fbac40051d6d064fd2603ec7db7',
  openai: 'b77293fb90e1adfd8024b2ca842d3413c91c7a81bee6597543d80c5f0d76bc08',
  xai: 'c1f737af2102dbf56b07395347148a84b840a654a5440921686f9ae2e112bb04',
  bedrock: '2e4ed890f8b0ee8357289d1c63c3bf22d53a3047a69e181705a88997d43d5968',
  antgroup: '589e0c53c5713558684bf42106d0316883ece9a47bb7fe51f187aa20b9551ec2',
  anthropic: '146ab3034dd076cab3a0e2c266ea854016d6de351765f06e8a52790fe8540cd7',
  baseten: 'c434aacc09d675c0d44be51718f3d27028b5b41ea2d449dab1bc897b5390cfe3',
  cerebras: '891ec18d3111812f65fa763e365efe04079f76468c37026550e0fcc49e08026c',
  cloudflare: '5e5e72695a574d65f3494108e3f7ed6967315cb35f7fb0bcb34738291fc2f281',
  deepseek: 'e3bcf06d3a578416be362db9afc2477feb2d532d05bf6bfbd6afbf636d4357c4',
  fireworksai: '09d87789949810900aa947742f683b3dd5653ad41e4c8c9bd943b7551847a649',
  google: '3e90248b4219738f742f9683186fd23f71ebfb74774292be866c9b7fd4bd16df',
  vertexai: '67c0ecea382cde697218cb121059f00a22a1f61201400aa28140528f52497691',
  gemini: 'b9bc05158eccbc1ccfdada24c4e4d824e083defed0f56b08867811106a106e47',
  groq: '2b505fd9dd3825c8ed404ecc7219ea24e4d3a07473489d4b2cf05c81bafb3dfb',
  huggingface: '2734ef452c6a506e4378841fafd08f0f6c75d00d2005759b383a5994824ef022',
  moonshot: '680301e569393411b02f3dc85dc79263c91d1c09072cc3a43fd31b3c665442fa',
  minimax: '92a28712f62cc1275d725c02efb153ebb146596be66bb3e64e0137a67425171c',
  mistral: 'c7e1078dafc4b314e278e2762f8796d2a2af7a4785e6cb7bc925063c1d90c6f5',
  nvidia: 'f6779a12431931a2e616432a73a82058c88c4cb34ec24d823b8cb4770216b7c4',
  opencode: 'bb12f2f6f598a2c9c9856dd3d04d80aea4ab0b48e5f6cd845e1bec9a01eda0b3',
  opencodego: 'bb12f2f6f598a2c9c9856dd3d04d80aea4ab0b48e5f6cd845e1bec9a01eda0b3',
  openrouter: '5b29907f0c7e773a29709964ae6dff1b50f93909370db0788252c0192fa4ba66',
  qwen: '5a1691df88088c1428c2b4c564792c207a45c2ca56f1e171c9424f6d46737c1d',
  togetherai: 'e2d3744c63eaa98ae2c1581c53886190be4004b369c9bc98a31a6726ef35f5f0',
  vercelaigateway: '0feabb4ace60634389cd5a23370e5add0f6fa890207adaae65f7ba29eaf72667',
  xiaomimimo: '957ca2e5e5d4db603d8e82f13d9f5d1ad1bb6969a377ef27dc562bdeaa95ccf0',
  zhipu: '5f9c77120361fde5e248ca6ad05ebaf22cc062a5b5a6ec3eca0b6961d11f5b0c',
  apple: 'ed1562d4e9b3f3dbbc53e2f5824647abae1795cfa7cb07860bda8cb9cf4beedf',
  microsoft: 'a846c38c3d72e695e8997bdbf5df37f10a1018cbe3e16fb3e114c89f705ef6c8',
  mcp: 'aa5b3c8939d8157bad799d36a2f7df77dbeb816f9cb51500ed6dee41cdcbb116',
  github: '41bdf0ad5f8a0c2397c7e9cc4af8f9eae706b29ff20cf1c1bb69af8f5803ebef',
  notion: 'cdb5f13723a624821cb19b3b6d07ee6fb2e328bde4cf9634f02a7ea6b6faa938',
  claude: 'da006eb4a04abd763b86837d495d2cecade7e5d0b33142bd90747a9b54cd6570',
  'claude-code': 'f07191f621ae8afaa381654688daa120d88baccc67a2a7517f9680dbc669e292',
  devin: '1f476608b84c2bab6084c760ad497f1bed6f1f9227d54ed52e54b47c19069be3',
  antigravity: 'adb0c2ccb62a2d52702c79243c00f69aa6ceb7e62d69e3b87165095e9505b938',
  doubao: '715154b270706d65a7c76c71a0243b8e76aa32c92851b869e71d52c96fe54430',
} as const;

describe('LobeHub mono icon provenance', () => {
  it('has a pinned upstream digest for every mark', () => {
    expect(Object.keys(LOBEHUB_MONO).sort()).toEqual(Object.keys(upstream).sort());
  });

  it.each(Object.entries(LOBEHUB_MONO))('%s matches @lobehub/icons-static-svg 1.106.0 (MIT)', (name, mark) => {
    const digest = createHash('sha256')
      .update(JSON.stringify({ viewBox: mark.viewBox, paths: mark.paths }))
      .digest('hex');
    expect(digest).toBe(upstream[name as keyof typeof upstream]);
  });

  it.each([
    ['Gemini', GeminiMark, upstream.gemini],
    ['Claude', ClaudeMark, upstream.claude],
    ['OpenAI', OpenAIMark, upstream.openai],
    ['Grok', GrokMark, '423ea86d9b1ff2fe8c00d336fb191ed433c69f15ab617afe55bac6d4d0d45731'],
    ['Anthropic', AnthropicMark, upstream.anthropic],
    ['Antigravity', AntigravityMark, upstream.antigravity],
    ['Claude Code', ClaudeCodeMark, upstream['claude-code']],
    ['Devin', DevinMark, upstream.devin],
  ])('%s component matches its upstream brand mark', (_name, component, expected) => {
    const svg = renderToStaticMarkup(createElement(component));
    const viewBox = svg.match(/viewBox="([^"]+)"/)?.[1];
    const paths = [...svg.matchAll(/<path\b[^>]*\bd="([^"]+)"/g)].map((match) => match[1]);
    const digest = createHash('sha256').update(JSON.stringify({ viewBox, paths })).digest('hex');
    expect(digest).toBe(expected);
  });

  it('renders the Doubao paths with the opacity in the upstream SVG', () => {
    const svg = renderToStaticMarkup(createElement(DoubaoMark));
    expect(svg.match(/<path\b/g)).toHaveLength(3);
    expect(svg.match(/fill-opacity="0.5"/g)).toHaveLength(2);
  });
});
