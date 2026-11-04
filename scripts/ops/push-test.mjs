import { pathToFileURL } from 'node:url';

export async function runPushTest(
  origin,
  teamId,
  userId,
  token,
  print = console.log,
  { timeoutMs = 720_000, pollMs = 1_000 } = {},
) {
  const url = new URL(`/api/teams/${encodeURIComponent(teamId)}/push/test`, origin);
  const deadline = Date.now() + timeoutMs;
  const headers = {
    'content-type': 'application/json',
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
  const request = async (target, options) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error('Push test deadline exceeded');
    const response = await fetch(target, {
      ...options,
      headers,
      signal: AbortSignal.timeout(Math.min(30_000, remaining)),
    });
    if (!response.ok) throw new Error(`Push test rejected: HTTP ${response.status}`);
    return response.json();
  };
  const { id } = await request(url, { method: 'POST', body: JSON.stringify({ userId }) });
  if (typeof id !== 'string' || !id) throw new Error('Push test missing delivery id');
  const statusUrl = new URL(`${url.pathname}/${encodeURIComponent(id)}`, origin);
  for (;;) {
    const outcome = await request(statusUrl, { method: 'GET' });
    if (['received', 'fallback-accepted', 'undelivered'].includes(outcome.alertStatus)) {
      print(JSON.stringify(outcome));
      return outcome.alertStatus === 'received' ? 0 : 1;
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error('Push test deadline exceeded');
    await new Promise((resolve) => setTimeout(resolve, Math.min(pollMs, remaining)));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [origin, teamId, userId] = process.argv.slice(2);
  if (!origin || !teamId || !userId) {
    console.error(
      'Usage: node scripts/ops/push-test.mjs <origin> <team-id> <user-id> (CAIRN_TOKEN optional)',
    );
    process.exitCode = 2;
  } else {
    try {
      process.exitCode = await runPushTest(origin, teamId, userId, process.env.CAIRN_TOKEN);
    } catch {
      console.error('Push test failed before a receipt outcome was available');
      process.exitCode = 1;
    }
  }
}
