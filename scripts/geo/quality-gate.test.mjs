import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { prepushPlan } from '../prepush.mjs';
import { makeTestTempDir, releaseTestTempDir } from '../test-tmpdir.mjs';
import { validateGeoSite } from './quality-gate.mjs';

function makeValidBody(topic, extra = '') {
  const sentences = [
    `Cairn lets you ${topic} directly from the Mac desktop app while keeping source code and credentials on your own machine.`,
    `Each task runs inside an isolated git worktree managed by the bundled Runner under ~/.cairn/workspaces so parallel threads never overwrite each other.`,
    `Download the latest Cairn DMG from GitHub Releases, drag it to Applications, and connect your existing ChatGPT subscription or provider API key under Settings -> Model.`,
    `Inside Connect models, ChatGPT subscription login uses a browser device code with the bundled pi engine so you never need to install the Codex CLI separately.`,
    `Headless Linux servers remain supported as an advanced self-hosted path via npx @xiechimon/cairn and Docker when you want to attach extra remote Runners.`,
    `Verify local machine readiness with cairn doctor and inspect live daemon output with cairn logs -f whenever a task stalls in Queued.`,
    `When a task completes, its changes remain on an isolated task branch until you review the diff and explicitly approve merging or pushing upstream.`,
    `Anything irreversible such as pushing to a remote, deleting data, or changing secrets pauses for your explicit confirmation before execution continues.`,
    extra,
  ].join(' ');
  return [
    sentences,
    '',
    '## Steps',
    '',
    '```sh',
    'cairn status',
    'cairn logs -f',
    '```',
    '',
    'See [Install](/docs/install/) and [Models](/docs/models/) for full setup details.',
    '',
    'Written with AI assistance from the Cairn source, verified on 2026-11-27 against desktop-v0.1.790.',
  ].join('\n');
}

function makeValidZhBody(topic) {
  return [
    `Cairn Mac \u684c\u9762\u7aef\u53ef\u4ee5\u5728\u672c\u5730\u76f4\u63a5\u5b8c\u6210${topic}\uff0c\u5e76\u4e14\u6240\u6709\u6e90\u7801\u3001SQLite \u72b6\u6001\u548c\u51ed\u636e\u90fd\u53ea\u4fdd\u7559\u5728\u4f60\u81ea\u5df1\u7684\u786c\u4ef6\u4e0a\u3002\u6bcf\u4e2a\u4efb\u52a1\u90fd\u5728 ~/.cairn/workspaces \u4e0b\u7684\u72ec\u7acb git worktree \u4e2d\u8fd0\u884c\uff0c\u907f\u514d\u591a\u4e2a Agent \u5e76\u884c\u4fee\u6539\u540c\u4e00\u4e2a\u5de5\u4f5c\u76ee\u5f55\u3002`,
    '',
    `\u4ece GitHub Releases \u4e0b\u8f7d\u6700\u65b0\u7684 Mac \u5b89\u88c5\u5305\u540e\uff0c\u5c06 Cairn \u62d6\u5165\u5e94\u7528\u7a0b\u5e8f\u6587\u4ef6\u5939\u5e76\u5728 Settings -> Model \u7ed1\u5b9a ChatGPT \u8ba2\u9605\u6216 API Key \u5373\u53ef\u5f00\u59cb\u4f7f\u7528\u3002\u6240\u6709 API \u5bc6\u94a5\u4e0e\u8ba2\u9605\u51ed\u636e\u90fd\u4f1a\u7528\u672c\u5730\u7684 secretbox.key \u52a0\u5bc6\u540e\u5b58\u5165 SQLite \u6570\u636e\u5e93\uff0c\u4e0d\u4f1a\u4e0a\u4f20\u5230\u7b2c\u4e09\u65b9\u4e2d\u8f6c\u670d\u52a1\u5668\u3002\u82e5\u9700\u5728 Linux \u670d\u52a1\u5668\u90e8\u7f72\u8fdb\u9636\u81ea\u6258\u7ba1\u8282\u70b9\uff0c\u53ef\u4f7f\u7528 npx @xiechimon/cairn \u6216 Docker \u63a5\u5165\u8fdc\u7a0b Runner\uff0c\u5e76\u901a\u8fc7 cairn doctor \u4e0e cairn logs -f \u6392\u67e5\u72b6\u6001\u3002\u5916\u51fa\u65f6\u8fd8\u53ef\u901a\u8fc7 Tailscale \u5728 iPhone \u4e0a\u67e5\u770b\u5dee\u5206\u5e76\u5ba1\u6279\u4efb\u52a1\uff0c\u5728\u63a8\u9001\u4e0a\u6e38\u5206\u652f\u524d\u5148\u68c0\u67e5\u672c\u5730\u53d8\u66f4\u4e0e\u6d4b\u8bd5\u7ed3\u679c\uff0c\u4efb\u4f55\u63a8\u9001\u4ee3\u7801\u6216\u5220\u9664\u6570\u636e\u7b49\u4e0d\u53ef\u9006\u64cd\u4f5c\u90fd\u4f1a\u6682\u505c\u7b49\u5f85\u4f60\u786e\u8ba4\u540e\u518d\u7ee7\u7eed\u6267\u884c\uff0c\u786e\u4fdd\u591a\u4efb\u52a1\u5e76\u884c\u53ef\u63a7\u3002`,
    '',
    '## \u64cd\u4f5c\u6b65\u9aa4',
    '',
    '```sh',
    'cairn status',
    'cairn logs -f',
    '```',
    '',
    '\u8be6\u7ec6\u8bf4\u660e\u8bf7\u53c2\u8003 [\u5b89\u88c5\u6307\u5357](/zh-cn/docs/install/) \u548c [\u6a21\u578b\u914d\u7f6e](/zh-cn/docs/models/)\u3002',
    '',
    '\u7531 AI \u57fa\u4e8e Cairn \u6e90\u7801\u8f85\u52a9\u7f16\u5199\uff0c\u4e8e 2026-11-27 \u5bf9\u7167 desktop-v0.1.790 \u9a8c\u8bc1\u3002',
  ].join('\n');
}

function defaultFaqHead(question, answer) {
  return [
    {
      tag: 'script',
      attrs: { type: 'application/ld+json' },
      content: JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: [
          {
            '@type': 'Question',
            name: question,
            acceptedAnswer: { '@type': 'Answer', text: answer },
          },
        ],
      }),
    },
  ];
}

function makeFixtureRepo({
  questions = [
    {
      id: 'q-one',
      slug: 'parallel-agents-mac',
      locale: 'en',
      template: 'qa',
      cluster: 'claude-code',
      question: 'How do I run parallel agents on Mac?',
      persona: 'claude-code-subscriber',
      intent: 'how-to',
      source_urls: ['https://github.com/xiechimon/cairn/issues/5201'],
      publishedAt: '2026-11-27',
      cairn_answer_exists: 'yes',
      status: 'published',
    },
  ],
  pages = [
    {
      relPath: 'guides/parallel-agents-mac.mdx',
      title: 'How to run parallel coding agents on Mac',
      description: 'Run parallel agents with isolated git worktrees in the Cairn Mac desktop app.',
      geo: {
        questionId: 'q-one',
        template: 'qa',
        cluster: 'claude-code',
        sources: ['README.md', 'docs/getting-started.md'],
        verifiedVersion: 'desktop-v0.1.790',
        verifiedDate: '2026-11-27',
      },
      head: defaultFaqHead(
        'How do I run parallel agents on Mac?',
        'Cairn runs parallel coding agents directly from the Mac desktop app in isolated git worktrees.',
      ),
      body: makeValidBody('run parallel coding agents on macOS'),
    },
  ],
  maintenanceState = null,
  extraRepoFiles = ['README.md', 'docs/getting-started.md'],
} = {}) {
  const root = makeTestTempDir('geo-gate-');
  for (const file of extraRepoFiles) {
    const full = join(root, file);
    mkdirSync(join(full, '..'), { recursive: true });
    if (file.endsWith('.json')) {
      writeFileSync(full, '{"name":"unrelated-config","private":true}\n');
    } else {
      writeFileSync(
        full,
        'Cairn Mac desktop app runs parallel coding agents in isolated git worktrees via Runner with local SQLite and secretbox.key encryption, Tailscale remote approval, ChatGPT pi engine, npx @xiechimon/cairn and Docker server, cairn doctor, and cairn logs.\n',
      );
    }
  }
  const siteDir = join(root, 'site');
  mkdirSync(join(siteDir, 'geo'), { recursive: true });
  mkdirSync(join(siteDir, 'public'), { recursive: true });
  writeFileSync(join(siteDir, 'public', 'robots.txt'), 'User-agent: *\nAllow: /\n');
  writeFileSync(join(siteDir, 'public', 'llms.txt'), '# Cairn\n');
  if (maintenanceState) {
    writeFileSync(join(siteDir, 'geo/maintenance-state.json'), JSON.stringify(maintenanceState));
  }
  for (const coreDoc of ['intro', 'install', 'models', 'runner', 'first-task', 'faq']) {
    const enDoc = join(siteDir, 'src/content/docs/docs', `${coreDoc}.mdx`);
    const zhDoc = join(siteDir, 'src/content/docs/zh-cn/docs', `${coreDoc}.mdx`);
    mkdirSync(join(enDoc, '..'), { recursive: true });
    mkdirSync(join(zhDoc, '..'), { recursive: true });
    writeFileSync(enDoc, '---\ntitle: Core\n---\nStub\n');
    writeFileSync(zhDoc, '---\ntitle: Core\n---\nStub\n');
  }
  writeFileSync(
    join(siteDir, 'geo/questions.jsonl'),
    `${questions.map((row) => JSON.stringify(row)).join('\n')}\n`,
  );
  for (const page of pages) {
    const target = join(siteDir, 'src/content/docs', page.relPath);
    mkdirSync(join(target, '..'), { recursive: true });
    const headBlock = page.head
      ? [
          'head:',
          ...page.head.flatMap((h) => [
            `  - tag: ${JSON.stringify(h.tag)}`,
            '    attrs:',
            ...Object.entries(h.attrs ?? {}).map(([k, v]) => `      ${k}: ${JSON.stringify(v)}`),
            `    content: ${JSON.stringify(h.content)}`,
          ]),
        ]
      : [];
    const yaml = [
      '---',
      `title: ${JSON.stringify(page.title)}`,
      `description: ${JSON.stringify(page.description)}`,
      'geo:',
      `  questionId: ${JSON.stringify(page.geo.questionId)}`,
      `  template: ${JSON.stringify(page.geo.template)}`,
      `  cluster: ${JSON.stringify(page.geo.cluster)}`,
      '  sources:',
      ...page.geo.sources.map((s) => `    - ${JSON.stringify(s)}`),
      `  verifiedVersion: ${JSON.stringify(page.geo.verifiedVersion)}`,
      `  verifiedDate: ${JSON.stringify(page.geo.verifiedDate)}`,
      ...(page.geo.competitorSources
        ? [
            '  competitorSources:',
            ...page.geo.competitorSources.flatMap((c) => [
              `    - url: ${JSON.stringify(c.url)}`,
              `      date: ${JSON.stringify(c.date)}`,
            ]),
          ]
        : []),
      ...headBlock,
      '---',
      '',
      page.body,
      '',
    ].join('\n');
    writeFileSync(target, yaml);
  }
  return { root, siteDir };
}

test('validateGeoSite passes on a grounded unique Mac-first page', () => {
  const { root, siteDir } = makeFixtureRepo();
  try {
    const result = validateGeoSite({ repoRoot: root, siteDir });
    assert.equal(result.ok, true, result.errors.join('\n'));
    assert.equal(result.checkedPages, 1);
  } finally {
    releaseTestTempDir(root);
  }
});

test('validateGeoSite rejects missing repo source paths, dead internal links, and hallucinated CLI subcommands', () => {
  const { root, siteDir } = makeFixtureRepo({
    pages: [
      {
        relPath: 'guides/parallel-agents-mac.mdx',
        title: 'Run parallel agents on Mac',
        description: 'Run parallel agents cleanly.',
        geo: {
          questionId: 'q-one',
          template: 'qa',
          cluster: 'claude-code',
          sources: ['README.md', 'docs/does-not-exist.md'],
          verifiedVersion: 'desktop-v0.1.790',
          verifiedDate: '2026-11-27',
        },
        head: defaultFaqHead(
          'How do I run parallel agents on Mac?',
          'Cairn runs parallel coding agents.',
        ),
        body: [
          makeValidBody('run parallel agents'),
          'Run `cairn deploy-cloud --all` and visit [Missing](/guides/no-such-page/).',
        ].join('\n\n'),
      },
    ],
  });
  try {
    const result = validateGeoSite({ repoRoot: root, siteDir });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes('docs/does-not-exist.md')));
    assert.ok(result.errors.some((e) => e.includes('/guides/no-such-page/')));
    assert.ok(result.errors.some((e) => e.includes('deploy-cloud')));
  } finally {
    releaseTestTempDir(root);
  }

  const ungrounded = makeFixtureRepo({
    extraRepoFiles: ['unrelated-a.json', 'unrelated-b.json'],
    pages: [
      {
        relPath: 'guides/parallel-agents-mac.mdx',
        title: 'Run parallel agents on Mac',
        description: 'Run parallel agents cleanly.',
        geo: {
          questionId: 'q-one',
          template: 'qa',
          cluster: 'claude-code',
          sources: ['unrelated-a.json', 'unrelated-b.json'],
          verifiedVersion: 'desktop-v0.1.790',
          verifiedDate: '2026-11-27',
        },
        head: defaultFaqHead(
          'How do I run parallel agents on Mac?',
          'Cairn runs parallel coding agents on Mac.',
        ),
        body: makeValidBody('run parallel agents'),
      },
    ],
  });
  try {
    const ungroundedRes = validateGeoSite({
      repoRoot: ungrounded.root,
      siteDir: ungrounded.siteDir,
    });
    assert.equal(ungroundedRes.ok, false);
    assert.ok(ungroundedRes.errors.some((e) => /supporting evidence terms/i.test(e)));
  } finally {
    releaseTestTempDir(ungrounded.root);
  }
});

test('validateGeoSite rejects template/cluster mismatch, topic drift, and mismatched JSON-LD', () => {
  const { root, siteDir } = makeFixtureRepo({
    pages: [
      {
        relPath: 'guides/parallel-agents-mac.mdx',
        title: 'Local backup encryption overview',
        description: 'Encrypt backups.',
        geo: {
          questionId: 'q-one',
          template: 'hub',
          cluster: 'privacy',
          sources: ['README.md', 'docs/getting-started.md'],
          verifiedVersion: 'desktop-v0.1.790',
          verifiedDate: '2026-11-27',
        },
        head: defaultFaqHead(
          'Unrelated question',
          'Totally fabricated claim about blockchain tokens.',
        ),
        body: `This guide explains how to rotate SQLite encryption keys on Linux servers using open-source tools.\n\n${makeValidBody('encrypt sqlite database backups cleanly')}`,
      },
    ],
  });
  try {
    const result = validateGeoSite({ repoRoot: root, siteDir });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => /mismatches question row/i.test(e)));
    assert.ok(result.errors.some((e) => /question topic/i.test(e)));
    assert.ok(result.errors.some((e) => /JSON-LD/i.test(e)));
  } finally {
    releaseTestTempDir(root);
  }
});

test('validateGeoSite enforces FREEZE_AND_AUDIT when adding new pages', () => {
  const { root, siteDir } = makeFixtureRepo({
    maintenanceState: {
      growthDecision: 'FREEZE_AND_AUDIT',
      frozenQuestionIds: ['q-existing'],
    },
  });
  try {
    const result = validateGeoSite({ repoRoot: root, siteDir });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => /FREEZE_AND_AUDIT/i.test(e)));
  } finally {
    releaseTestTempDir(root);
  }
});

test('validateGeoSite rejects near-duplicate keyword variants in the same locale', () => {
  const { root, siteDir } = makeFixtureRepo({
    questions: [
      {
        id: 'q-one',
        slug: 'parallel-agents-mac',
        locale: 'en',
        template: 'qa',
        cluster: 'claude-code',
        question: 'How do I run parallel agents on Mac?',
        persona: 'claude-code-subscriber',
        intent: 'how-to',
        source_urls: ['https://github.com/xiechimon/cairn/issues/5201'],
        cairn_answer_exists: 'yes',
        status: 'published',
      },
      {
        id: 'q-two',
        slug: 'multiple-agents-mac-variant',
        locale: 'en',
        template: 'qa',
        cluster: 'claude-code',
        question: 'How do I run multiple agents on macOS?',
        persona: 'claude-code-subscriber',
        intent: 'how-to',
        source_urls: ['https://github.com/xiechimon/cairn/issues/5201'],
        cairn_answer_exists: 'yes',
        status: 'published',
      },
    ],
    pages: [
      {
        relPath: 'guides/parallel-agents-mac.mdx',
        title: 'Run parallel agents on Mac',
        description: 'Run parallel agents on Mac.',
        geo: {
          questionId: 'q-one',
          template: 'qa',
          cluster: 'claude-code',
          sources: ['README.md', 'docs/getting-started.md'],
          verifiedVersion: 'desktop-v0.1.790',
          verifiedDate: '2026-11-27',
        },
        head: defaultFaqHead(
          'How do I run parallel agents on Mac?',
          'Cairn runs parallel coding agents on macOS.',
        ),
        body: makeValidBody('run parallel coding agents on macOS'),
      },
      {
        relPath: 'guides/multiple-agents-mac-variant.mdx',
        title: 'Run multiple agents on macOS',
        description: 'Run multiple agents on macOS.',
        geo: {
          questionId: 'q-two',
          template: 'qa',
          cluster: 'claude-code',
          sources: ['README.md', 'docs/getting-started.md'],
          verifiedVersion: 'desktop-v0.1.790',
          verifiedDate: '2026-11-27',
        },
        head: defaultFaqHead(
          'How do I run multiple agents on macOS?',
          'Cairn runs multiple coding agents on macOS.',
        ),
        body: makeValidBody('run multiple coding agents on macOS'),
      },
    ],
  });
  try {
    const result = validateGeoSite({ repoRoot: root, siteDir });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => /duplicate|similarity/i.test(e)));
  } finally {
    releaseTestTempDir(root);
  }
});

test('validateGeoSite enforces Mac-first positioning, planned-feature honesty, and title discipline', () => {
  const { root, siteDir } = makeFixtureRepo({
    pages: [
      {
        relPath: 'guides/parallel-agents-mac.mdx',
        title: 'Cairn Mac | Parallel Claude | Worktree | Self-Hosted | 2026',
        description: 'Keyword stuffed title and misleading claims.',
        geo: {
          questionId: 'q-one',
          template: 'qa',
          cluster: 'claude-code',
          sources: ['README.md', 'docs/getting-started.md'],
          verifiedVersion: 'desktop-v0.1.790',
          verifiedDate: '2026-11-27',
        },
        head: defaultFaqHead(
          'How do I run parallel agents on Mac?',
          'Cairn runs parallel agents on Mac.',
        ),
        body: makeValidBody(
          'install via npx @xiechimon/cairn only and sign up for Cairn Cloud is available today',
        ),
      },
    ],
  });
  try {
    const result = validateGeoSite({ repoRoot: root, siteDir });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => /title/i.test(e)));
    assert.ok(result.errors.some((e) => /positioning|npx/i.test(e)));
    assert.ok(result.errors.some((e) => /Cairn Cloud/i.test(e)));
  } finally {
    releaseTestTempDir(root);
  }
});

test('validateGeoSite requires dated competitorSources and concession heading on compare pages', () => {
  const { root, siteDir } = makeFixtureRepo({
    questions: [
      {
        id: 'q-cmp',
        slug: 'cairn-vs-conductor',
        locale: 'en',
        template: 'compare',
        cluster: 'comparisons',
        question: 'Cairn vs Conductor?',
        persona: 'claude-code-subscriber',
        intent: 'compare',
        source_urls: ['https://www.conductor.build/docs'],
        cairn_answer_exists: 'no',
        status: 'published',
      },
    ],
    pages: [
      {
        relPath: 'guides/cairn-vs-conductor.mdx',
        title: 'Cairn vs Conductor for Mac',
        description: 'Compare Cairn and Conductor.',
        geo: {
          questionId: 'q-cmp',
          template: 'compare',
          cluster: 'comparisons',
          sources: ['README.md', 'docs/getting-started.md'],
          verifiedVersion: 'desktop-v0.1.790',
          verifiedDate: '2026-11-27',
        },
        head: defaultFaqHead('Cairn vs Conductor?', 'Compare Cairn and Conductor on macOS.'),
        body: makeValidBody('compare Cairn and Conductor on macOS'),
      },
    ],
  });
  try {
    const result = validateGeoSite({ repoRoot: root, siteDir });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => /competitorSources/i.test(e)));
    assert.ok(result.errors.some((e) => /concession|better/i.test(e)));
  } finally {
    releaseTestTempDir(root);
  }
});

test('validateGeoSite requires CN community sources for Chinese pages while permitting genuine same-slug localization', () => {
  const { root, siteDir } = makeFixtureRepo({
    questions: [
      {
        id: 'q-en',
        slug: 'parallel-agents-mac',
        locale: 'en',
        template: 'qa',
        cluster: 'claude-code',
        question: 'How do I run parallel agents on Mac?',
        persona: 'claude-code-subscriber',
        intent: 'how-to',
        source_urls: ['https://github.com/xiechimon/cairn/issues/5201'],
        cairn_answer_exists: 'yes',
        status: 'published',
      },
      {
        id: 'q-zh',
        slug: 'parallel-agents-mac',
        locale: 'zh-cn',
        template: 'qa',
        cluster: 'claude-code',
        question: 'Mac \u4e0a\u600e\u4e48\u5e76\u884c\u8dd1\u591a\u4e2a Agent\uff1f',
        persona: 'claude-code-subscriber',
        intent: 'how-to',
        source_urls: ['https://news.ycombinator.com/item?id=46682551'],
        cairn_answer_exists: 'yes',
        status: 'published',
      },
    ],
    pages: [
      {
        relPath: 'guides/parallel-agents-mac.mdx',
        title: 'Run parallel agents on Mac',
        description: 'Run parallel agents cleanly.',
        geo: {
          questionId: 'q-en',
          template: 'qa',
          cluster: 'claude-code',
          sources: ['README.md', 'docs/getting-started.md'],
          verifiedVersion: 'desktop-v0.1.790',
          verifiedDate: '2026-11-27',
        },
        head: defaultFaqHead(
          'How do I run parallel agents on Mac?',
          'Cairn runs parallel agents on Mac.',
        ),
        body: makeValidBody('run parallel agents'),
      },
      {
        relPath: 'zh-cn/guides/parallel-agents-mac.mdx',
        title: 'Mac \u5e76\u884c\u8dd1 Agent',
        description: 'Mac \u5e76\u884c\u8dd1 Agent \u6307\u5357\u3002',
        geo: {
          questionId: 'q-zh',
          template: 'qa',
          cluster: 'claude-code',
          sources: ['README.md', 'docs/getting-started.md'],
          verifiedVersion: 'desktop-v0.1.790',
          verifiedDate: '2026-11-27',
        },
        head: defaultFaqHead(
          'Mac \u5e76\u884c\u8dd1 Agent',
          'Cairn Mac \u684c\u9762\u7aef\u5e76\u884c\u8fd0\u884c Agent\u3002',
        ),
        body: makeValidBody(
          '\u5728 macOS \u4e0a\u5e76\u884c\u8fd0\u884c\u591a\u4e2a\u7f16\u7a0b Agent \u5e76\u9694\u79bb\u5de5\u4f5c\u6811',
        ),
      },
    ],
  });
  try {
    const result = validateGeoSite({ repoRoot: root, siteDir });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => /Chinese-community/i.test(e)));
  } finally {
    releaseTestTempDir(root);
  }

  const validSameSlug = makeFixtureRepo({
    questions: [
      {
        id: 'q-en',
        slug: 'parallel-agents-mac',
        locale: 'en',
        template: 'qa',
        cluster: 'claude-code',
        question: 'How do I run parallel agents on Mac?',
        persona: 'claude-code-subscriber',
        intent: 'how-to',
        source_urls: ['https://github.com/xiechimon/cairn/issues/5201'],
        cairn_answer_exists: 'yes',
        status: 'published',
      },
      {
        id: 'q-zh-ok',
        slug: 'parallel-agents-mac',
        locale: 'zh-cn',
        template: 'qa',
        cluster: 'claude-code',
        question: 'Mac \u4e0a\u600e\u4e48\u5e76\u884c\u8dd1\u591a\u4e2a Agent\uff1f',
        persona: 'claude-code-subscriber',
        intent: 'how-to',
        source_urls: ['https://www.v2ex.com/t/1191299'],
        cairn_answer_exists: 'yes',
        status: 'published',
      },
      {
        id: 'q-zh-dup',
        slug: 'mac-parallel-agent-copy',
        locale: 'zh-cn',
        template: 'qa',
        cluster: 'claude-code',
        question: 'Mac \u4e0a\u600e\u4e48\u5e76\u884c\u8dd1\u591a\u4e2a Agent\uff1f',
        persona: 'claude-code-subscriber',
        intent: 'how-to',
        source_urls: ['https://www.v2ex.com/t/1191299'],
        cairn_answer_exists: 'yes',
        status: 'published',
      },
    ],
    pages: [
      {
        relPath: 'guides/parallel-agents-mac.mdx',
        title: 'Run parallel agents on Mac',
        description: 'Run parallel agents cleanly.',
        geo: {
          questionId: 'q-en',
          template: 'qa',
          cluster: 'claude-code',
          sources: ['README.md', 'docs/getting-started.md'],
          verifiedVersion: 'desktop-v0.1.790',
          verifiedDate: '2026-11-27',
        },
        head: defaultFaqHead(
          'How do I run parallel agents on Mac?',
          'Cairn runs parallel agents on Mac.',
        ),
        body: makeValidBody('run parallel agents'),
      },
      {
        relPath: 'zh-cn/guides/parallel-agents-mac.mdx',
        title: 'Mac \u5e76\u884c\u8dd1 Agent',
        description: 'Mac \u5e76\u884c\u8dd1 Agent \u6307\u5357\u3002',
        geo: {
          questionId: 'q-zh-ok',
          template: 'qa',
          cluster: 'claude-code',
          sources: ['README.md', 'docs/getting-started.md'],
          verifiedVersion: 'desktop-v0.1.790',
          verifiedDate: '2026-11-27',
        },
        head: defaultFaqHead(
          'Mac \u5e76\u884c\u8dd1 Agent',
          'Cairn Mac \u684c\u9762\u7aef\u5e76\u884c\u8fd0\u884c Agent\u3002',
        ),
        body: makeValidZhBody(
          '\u5728 macOS \u4e0a\u5e76\u884c\u8fd0\u884c\u591a\u4e2a Agent \u5e76\u9694\u79bb git worktree',
        ),
      },
    ],
  });
  try {
    const okRes = validateGeoSite({ repoRoot: validSameSlug.root, siteDir: validSameSlug.siteDir });
    assert.equal(okRes.ok, true, okRes.errors.join('\n'));
    const dupZhBody = makeValidZhBody(
      '\u5728 macOS \u4e0a\u5e76\u884c\u8fd0\u884c\u591a\u4e2a Agent \u5e76\u9694\u79bb git worktree',
    );
    writeFileSync(
      join(validSameSlug.siteDir, 'src/content/docs/zh-cn/guides/mac-parallel-agent-copy.mdx'),
      [
        '---',
        'title: "Mac \u5e76\u884c\u8dd1\u591a Agent"',
        'description: "Mac \u5e76\u884c\u8dd1 Agent \u526f\u672c\u3002"',
        'geo:',
        '  questionId: "q-zh-dup"',
        '  template: "qa"',
        '  cluster: "claude-code"',
        '  sources:',
        '    - "README.md"',
        '    - "docs/getting-started.md"',
        '  verifiedVersion: "desktop-v0.1.790"',
        '  verifiedDate: "2026-11-27"',
        `head:\n  - tag: script\n    attrs:\n      type: application/ld+json\n    content: ${JSON.stringify(JSON.stringify({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: [{ '@type': 'Question', name: 'Mac \u5e76\u884c\u8dd1 Agent', acceptedAnswer: { '@type': 'Answer', text: 'Cairn Mac \u684c\u9762\u7aef\u5e76\u884c\u8fd0\u884c Agent\u3002' } }] }))}`,
        '---',
        '',
        dupZhBody,
      ].join('\n'),
    );
    const dupResult = validateGeoSite({
      repoRoot: validSameSlug.root,
      siteDir: validSameSlug.siteDir,
    });
    assert.equal(dupResult.ok, false);
    assert.ok(dupResult.errors.some((e) => /near-duplicate/i.test(e)));
  } finally {
    releaseTestTempDir(validSameSlug.root);
  }
});

test('validateGeoSite rejects thin pages, invalid verifiedVersion format, and missing verification disclosure', () => {
  const { root, siteDir } = makeFixtureRepo({
    pages: [
      {
        relPath: 'guides/parallel-agents-mac.mdx',
        title: 'Run parallel agents on Mac',
        description: 'Too short and unverified.',
        geo: {
          questionId: 'q-one',
          template: 'qa',
          cluster: 'claude-code',
          sources: ['README.md', 'docs/getting-started.md'],
          verifiedVersion: 'v-stale-bad',
          verifiedDate: '2026-11-27',
        },
        head: defaultFaqHead('How do I run parallel agents on Mac?', 'Run parallel agents on Mac.'),
        body: 'Too short answer without enough substance or disclosure.',
      },
    ],
  });
  try {
    const result = validateGeoSite({ repoRoot: root, siteDir });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => /too thin|word|substance/i.test(e)));
    assert.ok(result.errors.some((e) => /desktop-v<semver>/i.test(e)));
    assert.ok(result.errors.some((e) => /disclosure|verifiedVersion/i.test(e)));
  } finally {
    releaseTestTempDir(root);
  }
});

test('site build script, prepush plan, single analytics beacon, robots, and EN/ZH sidebars wire GEO', () => {
  const repoRoot = resolve(import.meta.dirname, '../..');
  const sitePkg = JSON.parse(readFileSync(join(repoRoot, 'site/package.json'), 'utf8'));
  assert.ok(sitePkg.scripts.build.includes('quality-gate.mjs'));
  const plan = prepushPlan(['site/src/content/docs/guides/index.mdx'], 'ci').map((s) =>
    s.join(' '),
  );
  assert.ok(plan.includes('node scripts/geo/quality-gate.mjs'));

  const astroConfig = readFileSync(join(repoRoot, 'site/astro.config.mjs'), 'utf8');
  assert.equal((astroConfig.match(/cloudflareinsights\.com/g) ?? []).length, 1);
  assert.equal(/@vercel\/analytics/.test(astroConfig), false);
  assert.ok(astroConfig.includes("slug: 'guides'"));
  assert.ok(astroConfig.includes("'zh-CN'"));
  assert.equal(existsSync(join(repoRoot, 'site/src/content/docs/guides/index.mdx')), true);
  assert.equal(existsSync(join(repoRoot, 'site/src/content/docs/zh-cn/guides/index.mdx')), true);

  const robots = readFileSync(join(repoRoot, 'site/public/robots.txt'), 'utf8');
  assert.ok(robots.includes('Allow: /'));
  assert.ok(robots.includes('Sitemap: https://cairn.xmon.me/sitemap-index.xml'));

  const homeAstro = readFileSync(join(repoRoot, 'site/src/components/Home.astro'), 'utf8');
  assert.ok(homeAstro.includes('<style>'));
  assert.ok(homeAstro.includes('Cairn Mac desktop app'));
  assert.equal((homeAstro.match(/<CloudflareBeacon \/>/g) ?? []).length, 1);
  const beacon = readFileSync(join(repoRoot, 'site/src/components/CloudflareBeacon.astro'), 'utf8');
  assert.equal((beacon.match(/cloudflareinsights\.com/g) ?? []).length, 1);
  assert.equal(/@vercel\/analytics/.test(homeAstro), false);

  const realResult = validateGeoSite({ repoRoot });
  assert.equal(realResult.ok, true, realResult.errors.join('\n'));
  assert.ok(realResult.checkedPages >= 50);
});
