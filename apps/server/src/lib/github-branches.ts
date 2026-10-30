import type { GithubRepoRef, ProjectBranchesResponse } from '@cairn/shared';
import { z } from 'zod';
import { HttpError } from './errors.js';
import type { FetchLike } from './github.js';

const repositorySchema = z.object({ default_branch: z.string().min(1).nullable() });
const branchesSchema = z.array(z.object({ name: z.string().min(1) }));

export async function githubBranches(
  fetchImpl: FetchLike,
  token: string | null,
  ref: GithubRepoRef,
): Promise<ProjectBranchesResponse> {
  const base = `https://api.github.com/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}`;
  const read = async (url: string): Promise<unknown> => {
    try {
      const response = await fetchImpl(url, {
        headers: {
          accept: 'application/vnd.github+json',
          'x-github-api-version': '2022-11-28',
          'user-agent': 'cairn-server',
          ...(token !== null ? { authorization: `Bearer ${token}` } : {}),
        },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        throw new HttpError(response.status === 404 ? 404 : 502, 'Unable to read GitHub branches');
      }
      return await response.json();
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(502, 'Unable to read GitHub branches');
    }
  };
  const repository = repositorySchema.safeParse(await read(base));
  if (!repository.success) throw new HttpError(502, 'Invalid GitHub repository response');
  const defaultBranch = repository.data.default_branch;
  const branches: ProjectBranchesResponse['branches'] = [];
  for (let page = 1; page <= 10; page += 1) {
    const result = branchesSchema.safeParse(
      await read(`${base}/branches?per_page=100&page=${page}`),
    );
    if (!result.success) throw new HttpError(502, 'Invalid GitHub branches response');
    branches.push(...result.data.map(({ name }) => ({ name, isDefault: name === defaultBranch })));
    if (result.data.length < 100) break;
  }
  return { defaultBranch, branches };
}
