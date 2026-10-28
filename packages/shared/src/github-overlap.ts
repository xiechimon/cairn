export interface GithubOverlapItem {
  number: number;
  title: string;
  body: string | null;
  state: string;
  head?: { ref: string };
  html_url: string;
}

export interface GithubOverlapReport {
  repo: string;
  checkedAt: string;
  since: string;
  terms: string[];
  paths: string[];
  openIssues: GithubOverlapItem[];
  openPulls: GithubOverlapItem[];
  recentPulls: GithubOverlapItem[];
  filePulls: (GithubOverlapItem & { overlappingFiles: string[] })[];
}

export async function lookupOverlaps({
  repo,
  terms,
  paths = [],
  request,
  now = new Date(),
}: {
  repo: string;
  terms: string[];
  paths?: string[];
  request: (path: string) => Promise<unknown[]>;
  now?: Date;
}): Promise<GithubOverlapReport> {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('Expected --repo owner/name');
  const words = [...new Set(terms.map((term) => term.trim()).filter(Boolean))];
  if (!words.length) throw new Error('At least one --term is required');
  if (paths.some((path) => typeof path !== 'string' || !path.trim()))
    throw new Error('Each planned path must be non-empty');
  const since = new Date(now.getTime() - 7 * 86400000).toISOString().slice(0, 10);
  const query = words.map((term) => `"${term.replace(/["\\]/g, ' ')}"`).join(' OR ');
  const items = (raw: unknown[], kind: 'issues' | 'pull'): GithubOverlapItem[] =>
    raw.map((item) => {
      if (typeof item !== 'object' || item === null)
        throw new Error('Malformed GitHub overlap item');
      const value = item as Record<string, unknown>;
      if (
        !Number.isSafeInteger(value.number) ||
        Number(value.number) < 1 ||
        typeof value.title !== 'string' ||
        (value.body !== null && typeof value.body !== 'string') ||
        typeof value.state !== 'string'
      )
        throw new Error('Malformed GitHub overlap item');
      const head = value.head;
      return {
        number: Number(value.number),
        title: value.title,
        body: value.body,
        state: value.state,
        html_url: `https://github.com/${repo}/${kind}/${value.number}`,
        ...(typeof head === 'object' &&
        head !== null &&
        'ref' in head &&
        typeof head.ref === 'string'
          ? { head: { ref: head.ref } }
          : {}),
      };
    });
  const search = async (scope: string) =>
    items(
      await request(
        `search/issues?q=${encodeURIComponent(`repo:${repo} ${scope} in:title,body ${query}`)}&per_page=100`,
      ),
      scope.startsWith('is:issue') ? 'issues' : 'pull',
    );
  const openIssues = await search('is:issue is:open');
  const openPulls = await search('is:pr is:open');
  const recentPulls = await search(`is:pr is:merged merged:>=${since}`);
  const filePulls: GithubOverlapReport['filePulls'] = [];
  if (paths.length) {
    const planned = new Set(paths.map((path) => path.replace(/^\.\//, '')));
    const pulls = items(await request(`repos/${repo}/pulls?state=open&per_page=100`), 'pull');
    for (const pull of pulls)
      if (typeof pull.head?.ref !== 'string') throw new Error('Missing GitHub PR head branch');
    const matches = new Map<number, GithubOverlapReport['filePulls'][number]>();
    let next = 0;
    let stopped = false;
    const outcomes = await Promise.allSettled(
      Array.from({ length: Math.min(3, pulls.length) }, async () => {
        while (!stopped) {
          const index = next++;
          const pull = pulls[index];
          if (pull === undefined) return;
          try {
            const files = await request(`repos/${repo}/pulls/${pull.number}/files?per_page=100`);
            const overlappingFiles: string[] = [];
            for (const file of files) {
              if (
                typeof file !== 'object' ||
                file === null ||
                !('filename' in file) ||
                typeof file.filename !== 'string'
              )
                throw new Error('Malformed GitHub PR file');
              if (
                planned.has(file.filename) ||
                ('previous_filename' in file &&
                  typeof file.previous_filename === 'string' &&
                  planned.has(file.previous_filename))
              )
                overlappingFiles.push(file.filename);
            }
            if (overlappingFiles.length) matches.set(index, { ...pull, overlappingFiles });
          } catch (error) {
            stopped = true;
            throw error;
          }
        }
      }),
    );
    const rejected = outcomes.find((outcome) => outcome.status === 'rejected');
    if (rejected?.status === 'rejected') throw rejected.reason;
    for (let index = 0; index < pulls.length; index++) {
      const match = matches.get(index);
      if (match !== undefined) filePulls.push(match);
    }
  }
  return {
    repo,
    checkedAt: now.toISOString(),
    since,
    terms: words,
    paths,
    openIssues,
    openPulls,
    recentPulls,
    filePulls,
  };
}
