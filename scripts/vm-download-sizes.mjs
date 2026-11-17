import { readFileSync } from 'node:fs';

const manifest = JSON.parse(
  readFileSync(new URL('../apps/daemon/computer-image/image.json', import.meta.url), 'utf8'),
);
const KERNEL_URL =
  'https://github.com/kata-containers/kata-containers/releases/download/4.3.1/kata-static-4.3.1-arm64.tar.zst';
const INIT_IMAGE = 'ghcr.io/apple/containerization/vminit:0.54.0';
const ACCEPT = [
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.docker.distribution.manifest.v2+json',
].join(', ');

async function contentLength(url) {
  const response = await fetch(url, { method: 'HEAD', redirect: 'follow' });
  if (!response.ok) throw new Error(`HEAD ${url}: ${response.status}`);
  return Number(response.headers.get('content-length'));
}

async function imageBytes(reference) {
  const match = /^ghcr\.io\/([^@:]+)[@:](.+)$/.exec(reference);
  if (!match) throw new Error(`not a ghcr reference: ${reference}`);
  const [, repo, ref] = match;
  const { token } = await (
    await fetch(`https://ghcr.io/token?scope=repository:${repo}:pull`)
  ).json();
  const get = async (r) =>
    (
      await fetch(`https://ghcr.io/v2/${repo}/manifests/${r}`, {
        headers: { authorization: `Bearer ${token}`, accept: ACCEPT },
      })
    ).json();
  let doc = await get(ref);
  const arm = doc.manifests?.find(
    (m) => m.platform?.os === 'linux' && m.platform?.architecture === 'arm64',
  );
  if (arm) doc = await get(arm.digest);
  return doc.layers.reduce((sum, layer) => sum + layer.size, 0);
}

const measured = {
  runtime: await contentLength(manifest.runtime.url),
  kernel: await contentLength(KERNEL_URL),
  init: await imageBytes(INIT_IMAGE),
  image: await imageBytes(manifest.image),
};

const source = readFileSync(
  new URL('../packages/shared/src/records/machine-capabilities.ts', import.meta.url),
  'utf8',
);
const block = /VM_DOWNLOAD_PARTS = \{([^}]*)\}/.exec(source)?.[1] ?? '';
const pinned = Object.fromEntries(
  [...block.matchAll(/(\w+): ([\d_]+)/g)].map(([, key, value]) => [
    key,
    Number(value.replaceAll('_', '')),
  ]),
);

console.log(JSON.stringify({ measured, pinned }, null, 2));
if (process.argv.includes('--check')) {
  const wrong = Object.keys(measured).filter((key) => measured[key] !== pinned[key]);
  if (wrong.length > 0) {
    console.error(`VM_DOWNLOAD_PARTS differs from the pinned sources: ${wrong.join(', ')}`);
    process.exit(1);
  }
}
