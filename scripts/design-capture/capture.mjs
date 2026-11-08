import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));
const probeSource = readFileSync(join(here, 'probe.js'), 'utf8');

const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    product: { type: 'string', default: 'claude-ai' },
    journey: { type: 'string', default: 'all' },
    width: { type: 'string', default: '1440' },
    scheme: { type: 'string', default: 'dark' },
    out: { type: 'string', default: join(homedir(), '.cache/cairn-design-capture/runs') },
    profile: { type: 'string', default: join(homedir(), '.cache/cairn-design-capture/profile') },
    base: { type: 'string' },
    headless: { type: 'boolean', default: false },
  },
});

const mode = positionals[0] ?? 'run';
const width = Number(args.width);
const mobile = width < 768;
const viewport = { width, height: mobile ? 812 : 900 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const launch = () =>
  chromium.launchPersistentContext(args.profile, {
    channel: 'chrome',
    headless: args.headless,
    viewport,
    deviceScaleFactor: mobile ? 2 : 1,
    isMobile: mobile,
    hasTouch: mobile,
    colorScheme: args.scheme,
    reducedMotion: 'no-preference',
    serviceWorkers: args.product === 'cairn' ? 'block' : 'allow',
    ignoreDefaultArgs: ['--enable-automation'],
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-background-timer-throttling',
      '--class=cairn-design-capture',
      '--window-name=cairn design capture',
    ],
  });

const login = async () => {
  const ctx = await launch();
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.goto('https://claude.ai/login');
  const deadline = Date.now() + 60 * 60 * 1000;
  while (Date.now() < deadline) {
    if (/claude\.ai\/(new|chat|recents|project)/.test(page.url())) break;
    await sleep(2000);
  }
  const ok = /claude\.ai\/(new|chat|recents|project)/.test(page.url());
  console.log(ok ? 'signed-in' : 'timeout');
  await ctx.close();
  process.exit(ok ? 0 : 1);
};

const startScreencast = async (page, dir) => {
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  let pending = Promise.resolve();
  cdp.on('Page.screencastFrame', (f) => {
    const ts = f.metadata.timestamp * 1000;
    const file = join(dir, `${String(frames.length).padStart(6, '0')}.jpg`);
    frames.push({ ts, file });
    pending = pending.then(() => writeFileSync(file, Buffer.from(f.data, 'base64')));
    cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send('Page.setWebLifecycleState', { state: 'active' }).catch(() => {});
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 85, everyNthFrame: 1 });
  return {
    async stop() {
      await cdp.send('Page.stopScreencast').catch(() => {});
      await pending;
      return frames;
    },
  };
};

const encode = (rawFrames, dir, outFile) => {
  const frames = [...rawFrames]
    .filter((f) => existsSync(f.file) && statSync(f.file).size > 0)
    .sort((a, b) => a.ts - b.ts);
  if (frames.length < 2) return false;
  const lines = ['ffconcat version 1.0'];
  for (let i = 0; i < frames.length; i++) {
    const next = frames[i + 1]?.ts ?? frames[i].ts + 500;
    lines.push(
      `file '${frames[i].file}'`,
      `duration ${(Math.max(1, next - frames[i].ts) / 1000).toFixed(4)}`,
    );
  }
  lines.push(`file '${frames.at(-1).file}'`);
  const list = join(dir, 'frames.ffconcat');
  writeFileSync(list, lines.join('\n'));
  try {
    execFileSync('ffmpeg', [
      '-y',
      '-loglevel',
      'error',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      list,
      '-vf',
      'fps=60,scale=trunc(iw/2)*2:trunc(ih/2)*2',
      '-c:v',
      'libx264',
      '-crf',
      '24',
      '-pix_fmt',
      'yuv420p',
      outFile,
    ]);
  } catch (e) {
    console.error(`encode failed: ${String(e).slice(0, 200)}`);
    return false;
  }
  return true;
};

const run = async () => {
  const mod = await import(join(here, 'journeys', `${args.product}.mjs`));
  const base = args.base ?? mod.baseUrl;
  const names = args.journey === 'all' ? Object.keys(mod.journeys) : args.journey.split(',');
  const ctx = await launch();
  await ctx.addInitScript({ content: probeSource });
  if (mod.themeStorageKey)
    await ctx.addInitScript(
      ([k, v]) => localStorage.setItem(k, v),
      [mod.themeStorageKey, args.scheme],
    );
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const runDir = resolve(args.out, `${stamp}-${args.product}-${width}-${args.scheme}`);
  mkdirSync(runDir, { recursive: true });
  const summary = [];
  const runJourney = async (name) => {
    const j = mod.journeys[name];
    const dir = join(runDir, name);
    const frameDir = join(dir, 'frames');
    mkdirSync(frameDir, { recursive: true });
    if (j.url) await page.goto(base + j.url, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.__dc, null, { timeout: 30000 });
    if (j.ready) await j.ready(page, { mobile });
    await sleep(800);
    const dumps = {
      initial: await page.evaluate((r) => window.__dc.dump({ roles: r }), mod.roles ?? {}),
    };
    const cast = await startScreencast(page, frameDir);
    await sleep(300);
    const probeInfo = await page.evaluate((o) => window.__dc.start(o), {
      watch: j.watch ?? [],
      textWatch: j.textWatch ?? [],
    });
    const steps = [];
    for (const step of j.steps) {
      const t0 = Date.now();
      await page.evaluate((l) => window.__dc.mark(`start:${l}`), step.label);
      let error;
      try {
        await step.run(page, { mobile, dumps, base });
      } catch (e) {
        error = String(e).slice(0, 300);
      }
      await sleep(step.settle ?? 1200);
      await page.evaluate((l) => window.__dc.mark(`end:${l}`), step.label);
      if (step.dump)
        dumps[step.label] = await page
          .evaluate((r) => window.__dc.dump({ roles: r }), mod.roles ?? {})
          .catch((e) => ({ error: String(e).slice(0, 200) }));
      if (step.rescan) await page.evaluate(() => window.__dc.rescanScrollers()).catch(() => {});
      steps.push({ label: step.label, nodeStart: t0, nodeEnd: Date.now(), error });
      if (error) console.error(`${name}/${step.label}: ${error}`);
    }
    const probe = await page.evaluate(() => window.__dc.stop());
    const frames = await cast.stop();
    writeFileSync(
      join(dir, 'probe.json'),
      JSON.stringify({
        product: args.product,
        journey: name,
        width,
        scheme: args.scheme,
        viewport,
        probeInfo,
        steps,
        ...probe,
        cast: frames.map((f) => ({ ts: f.ts, file: f.file.split('/').pop() })),
      }),
    );
    writeFileSync(join(dir, 'dumps.json'), JSON.stringify(dumps));
    const video = join(dir, `${args.product}-${name}-${width}-${args.scheme}.mp4`);
    const encoded = encode(frames, frameDir, video);
    summary.push({
      name,
      frames: frames.length,
      probeFrames: probe.frames.length,
      events: probe.events.length,
      mutations: probe.mutations.length,
      video: encoded ? video : null,
      errors: steps.filter((s) => s.error).length,
    });
    console.log(JSON.stringify(summary.at(-1)));
  };
  for (const name of names) {
    try {
      await runJourney(name);
    } catch (e) {
      await page.evaluate(() => window.__dc?.stop()).catch(() => {});
      summary.push({ name, failed: String(e).slice(0, 200) });
      console.error(`journey ${name} failed: ${String(e).slice(0, 200)}`);
    }
  }
  writeFileSync(join(runDir, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(`run ${runDir}`);
  await ctx.close();
};

if (mode === 'login') await login();
else await run();
