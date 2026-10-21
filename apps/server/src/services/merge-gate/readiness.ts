// 合并就绪判定（#1404，ADR 0021，spec 28 P3）：mergeReadiness(inputs) →
// {ready, headSha, patchDigest, policy, blockers}。纯函数，输入是 I/O 外壳读好
// 的事实（PR、检查、compare 的文件与提交、判定、轮次），不读库、不发请求、不取时钟。
// 规矩：读不到的输入变成 blocker，不跳过；全部 blocker 都列出（不短路），按
// MERGE_BLOCKERS 的固定顺序；blocking 与 chief 的 go 各自独立判，blocking 永远
// 拦得住。ready ⇔ blockers 为空。

import {
  type CompareFile,
  EVIDENCE_PREFIX,
  GATE_LIMITS,
  MERGE_BLOCKERS,
  MERGE_GATE_STATUS_CONTEXT,
  type MergeBlocker,
  type MergeBlockerCode,
  type MergePolicy,
  type MergeReadiness,
  type Phase,
} from '@pacman/shared';
import { computePatchDigest } from './digest.js';
import { parseRawEvidenceLinks } from './evidence-link.js';
import { classifyPaths } from './paths.js';

/** 一条判定在闸眼里的样子。patchDigest = 判定绑定的补丁摘要；判定 head 与
 * server 派步时写下的 expectedHeadSha 对不上时为 null（不算数）。 */
export interface GateVerdictView {
  kind: 'review' | 'verify' | 'decision';
  /** 审核视角；verify 为 null，chief 小合并步为 'chief'。 */
  perspective: string | null;
  patchDigest: string | null;
  outcome:
    | 'pass'
    | 'block'
    | 'extraction_failed'
    | 'step_failed'
    | 'tampered'
    | 'unbound'
    | 'evidence_invalid';
}

export interface GateCheckRun {
  name: string;
  /** queued / in_progress / completed …；外壳按 app 与名字只传最新的一条。 */
  status: string;
  conclusion: string | null;
}

export interface GateCommitStatus {
  context: string;
  /** error / failure / pending / success；外壳只传每个 context 最新的一条。 */
  state: string;
}

export interface GateInputs {
  policy: { mergePolicy: MergePolicy; autonomyPaused: boolean };
  build: { isGithubPr: boolean; isCurrent: boolean; phase: Phase; stepsInFlight: number };
  repo: { owner: string; name: string; defaultBranch: string | null };
  ticketRef: string;
  /** 任务来源解出的同仓 issue 号（D2 的 `closes #N` 靠它）；解不出为 null。 */
  issueNumber: number | null;
  pr: {
    state: 'open' | 'closed';
    merged: boolean;
    draft: boolean;
    /** null = GitHub 还没算出来。 */
    mergeableState: string | null;
    headSha: string;
    baseRef: string;
    baseRepoFullName: string;
    headRepoFullName: string | null;
    body: string;
    changedFiles: number;
  } | null;
  /** PR head 的检查；null = 读不到。headSha = 外壳读检查时请求的提交：check run 与
   * commit status 都按这一个 40 位小写 SHA 读（不按分支名）。它不等于 pr.headSha
   * （比 PR 旧或比 PR 新都算：缓存的响应、跨推送的两次读）= 这份结果说的是别的提交，
   * 整份按读不到处理（required-checks-unreadable，可等，下一次巡检再读）。GateCheckRun
   * 与 GateCommitStatus 不带各自的 SHA，这里只能对 headSha；响应里的 SHA（每条 check
   * run 的 head_sha、combined status 的 sha）由 S4 的外壳对过：有一条不等于请求的
   * SHA，这次读就不算在这个提交上读的，整份传 null。required 为 null = 必需清单读不到。runs 每个 (app, 名字) 最新的一条，statuses 每个 context
   * 最新的一条（同一 app 同名的旧条目不传）。S4 的外壳按 app 与名字去重，不能只按
   * 名字：两个 app 报同名的检查时，只按名字会让失败的那条被同名的通过盖掉，GitHub 的
   * rollup 却照样算它；自家 status 未通过时 unstable 又按自家豁免，闸就看着一条失败
   * 的检查放行。complete = runs 与 statuses 都读全了（分页读完）；false 时整份按读
   * 不到处理：缺席的可能只是没读到，未通过的可能在没读的那页。 */
  checks: {
    headSha: string;
    required: string[] | null;
    runs: GateCheckRun[];
    statuses: GateCommitStatus[];
    complete: boolean;
  } | null;
  /** compare {base}...{head} 一次读到的三样：
   * - headSha：外壳请求时写在 {head} 位置的提交，40 位小写 SHA（按 SHA 请求，不按分支
   *   名；按分支名读的 compare 不知道读在哪个提交上）。取请求的 SHA，不从响应里认：
   *   响应没有 head 提交的字段（只有 base_commit 与 merge_base_commit，permalink_url
   *   里是缩写），commits 按时间排、分页，末一个不保证是 head。
   * - files：全部文件（compareFilesFromResponse）。
   * - commits：本 PR 的提交 base..head（响应 commits[].sha，40 位小写，读全）。读全时
   *   含读到的 head。
   * headSha 不等于 pr.headSha（比 PR 旧或比 PR 新都算：缓存的响应、跨推送的两次读），
   * 或 commits 里没有 pr.headSha（按分支名或从缓存读的 compare，外壳却照 pr.headSha
   * 填了 headSha：这一条出自响应本身，不只信外壳填的值）= 文件与摘要说的不是 PR head
   * 的补丁，按读不到处理（patch-unavailable，可等，下一次巡检再读），文件数对不上也
   * 不报 compare-truncated：那是跨推送的竞态，不是截断。
   * 'unreadable' = 没读到（请求失败、超时、非 2xx），下一次巡检再读；'malformed' =
   * 读到了、形状不对（compareFilesFromResponse 返回 null，或 commits 不是 SHA 列表），
   * 每次读都一样，留人；headSha 不是 40 位小写 SHA 时外壳同样传 'malformed'，不要让
   * 它在这里成为永远对不上的可等。commits 少给别的提交只会让证据链少认（拦），不会
   * 多放。commits 不带逐提交的文件列表，所以证据链指向的文件在那个提交上是否已经存在
   * （raw 是否 404）这里判不了，由 I/O 外壳（S4）去查。PR 读不到时没有 head 可对：
   * compare 与检查照常判、blocker 照常列（pr-unreadable 已拦），结果不报 head，也不报
   * 摘要（没有 head 的摘要绑不到哪个提交上）。 */
  compare:
    | { headSha: string; files: CompareFile[]; commits: string[] }
    | 'unreadable'
    | 'malformed';
  /** 本构建的全部判定，各摘要上的都在内（换构建即换一份）。 */
  verdicts: GateVerdictView[];
  /** 当前摘要的闸轮次；perspectives 在建轮时冻结。human 策略下没有轮次。 */
  round: {
    perspectives: string[];
    timedOut: string[];
    fixRoundsExhausted: boolean;
    fixNoChange: boolean;
    gateRoundsExhausted: boolean;
  } | null;
  availability: { reviewerPerspectives: string[]; verifier: boolean; decider: boolean };
}

const PASSING_CONCLUSIONS = new Set(['success', 'neutral', 'skipped']);
const ORDER = new Map<string, number>(MERGE_BLOCKERS.map((b, i) => [b.code, i]));
const META = new Map<string, (typeof MERGE_BLOCKERS)[number]>(
  MERGE_BLOCKERS.map((b) => [b.code, b]),
);

// detail 里的名字（文件、检查、分支、仓库）由 PR 作者或第三方起，原样会把换行、
// 控制字符、指令样的文本与任意长的名单带进 status 描述与 chief 工具。名字一律写成
// JSON 字符串；JSON 不转义、读起来却会变样的字符（C1 控制符、双向覆盖之类的格式符、
// 行与段分隔符）也写成 \uXXXX。每个名字转义后至多 DETAIL_NAME_CHARS 个字符，超出
// 截断并在引号外标 …；每份名单至多 DETAIL_NAMES 个，其余记 +N more。
const DETAIL_NAMES = 10;
const DETAIL_NAME_CHARS = 120;
const UNSAFE_CHAR = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

function escapeChar(ch: string): string {
  const json = JSON.stringify(ch).slice(1, -1);
  if (json !== ch || !UNSAFE_CHAR.test(ch)) return json;
  return Array.from(
    { length: ch.length },
    (_, k) => `\\u${ch.charCodeAt(k).toString(16).padStart(4, '0')}`,
  ).join('');
}

function quoted(name: string): string {
  let body = '';
  for (const ch of name) {
    const esc = escapeChar(ch);
    if (body.length + esc.length > DETAIL_NAME_CHARS) return `"${body}"…`;
    body += esc;
  }
  return `"${body}"`;
}

function names(list: readonly string[]): string[] {
  const shown = list.slice(0, DETAIL_NAMES).map(quoted);
  return list.length > DETAIL_NAMES ? [...shown, `+${list.length - DETAIL_NAMES} more`] : shown;
}

const runPasses = (r: GateCheckRun) =>
  r.status === 'completed' && r.conclusion !== null && PASSING_CONCLUSIONS.has(r.conclusion);
const isOwnStatus = (s: GateCommitStatus) => s.context.toLowerCase() === MERGE_GATE_STATUS_CONTEXT;
const checkName = (x: GateCheckRun | GateCommitStatus) => ('name' in x ? x.name : x.context);

export function mergeReadiness(i: GateInputs): MergeReadiness {
  const found = new Map<MergeBlockerCode, string[]>();
  const block = (code: MergeBlockerCode, ...detail: string[]) => {
    found.set(code, [...(found.get(code) ?? []), ...detail]);
  };

  // 策略与车道
  if (i.policy.mergePolicy === 'human') block('policy-human');
  if (i.policy.autonomyPaused) block('autonomy-paused');
  if (!i.build.isGithubPr) block('not-applicable');
  if (!i.build.isCurrent) block('not-current-build');
  if (i.build.phase !== 'review') block('phase-not-review', i.build.phase);
  if (i.build.stepsInFlight > 0) block('work-in-flight', `${i.build.stepsInFlight} step(s)`);

  // PR
  const pr = i.pr;
  if (pr === null) {
    block('pr-unreadable');
  } else {
    if (pr.state !== 'open' || pr.merged) block('pr-not-open', pr.merged ? 'merged' : pr.state);
    if (pr.draft) block('pr-draft');
    if (
      pr.headRepoFullName === null ||
      pr.headRepoFullName.toLowerCase() !== pr.baseRepoFullName.toLowerCase()
    ) {
      block(
        'pr-from-fork',
        pr.headRepoFullName === null ? 'head repository deleted' : quoted(pr.headRepoFullName),
      );
    }
    // 默认分支读不到是输入读不到，可等；不能当成目标分支不对去留人。
    if (i.repo.defaultBranch === null) block('pr-unreadable', 'default branch unreadable');
    else if (pr.baseRef !== i.repo.defaultBranch)
      block('base-not-default', `${quoted(pr.baseRef)} → ${quoted(i.repo.defaultBranch)}`);
  }

  // 检查（PR 的 head）。在别的提交上读的、没读全的，都与读不到同等：不拿别的提交
  // 的结果判，也不拿半张清单判。judged = 下面已按必需检查或 pr-evidence 记过自己码
  // 的条目。
  let checks = i.checks;
  if (checks !== null && pr !== null && checks.headSha !== pr.headSha) {
    block('required-checks-unreadable', 'checks not read at the PR head');
    checks = null;
  } else if (checks !== null && !checks.complete) {
    block('required-checks-unreadable', 'check list incomplete');
    checks = null;
  }
  const judged = new Set<GateCheckRun | GateCommitStatus>();
  if (checks === null || checks.required === null) {
    block('required-checks-unreadable');
  } else {
    const required = checks.required;
    if (required.length === 0) block('required-checks-none');
    for (const name of required) {
      if (name.toLowerCase() === MERGE_GATE_STATUS_CONTEXT) {
        block('self-required');
        continue;
      }
      const run = checks.runs.find((r) => r.name === name);
      const status = checks.statuses.find((s) => s.context.toLowerCase() === name.toLowerCase());
      if (run !== undefined) {
        judged.add(run);
        if (run.status !== 'completed') block('required-check-pending', quoted(name));
        else if (!runPasses(run))
          block('required-check-failed', `${quoted(name)}: ${run.conclusion ?? 'none'}`);
      } else if (status !== undefined) {
        judged.add(status);
        if (status.state === 'pending') block('required-check-pending', quoted(name));
        else if (status.state !== 'success')
          block('required-check-failed', `${quoted(name)}: ${status.state}`);
      } else {
        block('required-check-missing', quoted(name));
      }
    }
  }
  if (checks !== null) {
    const evidence = checks.runs.find((r) => r.name === 'pr-evidence');
    if (evidence !== undefined) judged.add(evidence);
    if (
      evidence === undefined ||
      evidence.status !== 'completed' ||
      evidence.conclusion !== 'success'
    ) {
      block(
        'pr-evidence-not-green',
        evidence === undefined ? 'missing' : `${evidence.status}/${evidence.conclusion ?? 'none'}`,
      );
    }
  }

  // GitHub 的可合并判定。mergeable_state 是 GitHub 异步算的，可能还停在 clean；
  // 手上的检查清单更新，以它为准：未通过（失败或还在跑）的检查，除了自家
  // status，一律拦，必需检查之外的也拦。自家 status 不是必需检查，非 success
  // 时 GitHub 报 unstable；只因它 unstable 不算拦，否则闸会被自己卡死。但看
  // 不到任何未通过的检查却报 unstable，说不清是谁让它 unstable 的，拦。
  const notPassing =
    checks === null
      ? null
      : [
          ...checks.runs.filter((r) => !runPasses(r)),
          ...checks.statuses.filter((s) => s.state !== 'success' && !isOwnStatus(s)),
        ];
  const ownNotPassing =
    checks?.statuses.some((s) => s.state !== 'success' && isOwnStatus(s)) ?? false;
  if (pr !== null) {
    const state = pr.mergeableState;
    if (state === null || state === 'unknown') {
      block('mergeable-state', 'GitHub still computing');
    } else if (state === 'unstable') {
      if (notPassing === null) block('mergeable-state', 'unstable, checks unreadable');
      else if (notPassing.length > 0)
        block('mergeable-state', `unstable: ${names(notPassing.map(checkName)).join(', ')}`);
      else if (!ownNotPassing) block('mergeable-state', 'unstable, no failing check visible');
    } else if (state === 'clean' || state === 'has_hooks') {
      // 必需检查与 pr-evidence 上面已各记自己的码，这里不重复列。
      const foreign = (notPassing ?? []).filter((x) => !judged.has(x));
      if (foreign.length > 0)
        block(
          'mergeable-state',
          `${state}, not passing: ${names(foreign.map(checkName)).join(', ')}`,
        );
    } else {
      block('mergeable-state', state);
    }
  }

  // 补丁。compare 读不到可等；读到了形状不对，下一次读还是一样，留人。compare 不是在
  // PR 的 head 上读的（外壳填的 head 对不上，或响应自己的提交里没有这个 head）：说的是
  // 别的补丁，按读不到处理，下一次巡检再读；摘要、文件数、路径、证据链与判定都不拿它
  // 判，结果也不报它的摘要，免得把别的补丁的结论安到 head 上。
  let compare = typeof i.compare === 'string' ? null : i.compare;
  if (i.compare === 'unreadable') block('patch-unavailable', 'compare unreadable');
  if (i.compare === 'malformed') block('compare-malformed');
  if (
    compare !== null &&
    pr !== null &&
    (compare.headSha !== pr.headSha || !compare.commits.includes(pr.headSha))
  ) {
    block('patch-unavailable', 'compare not read at the PR head');
    compare = null;
  }
  let D: string | null = null;
  if (compare !== null) {
    const digest = computePatchDigest(compare.files, {
      expectedFileCount: pr?.changedFiles ?? null,
    });
    D = digest.patchDigest;
    if (digest.unavailable === 'truncated' || digest.unavailable === 'count-mismatch') {
      block('compare-truncated', digest.unavailable);
    } else if (digest.unavailable !== null) {
      // 只有证据（empty）或有文件缺 blob sha（null-sha）：等多久都算不出摘要，留人。
      block('patch-unbindable', digest.unavailable);
    }
    // 上限按整张补丁算：证据也计入，改名记两个文件（口径在 digest.ts）。不要
    // 换成 digest.kept 去数，那是摘要的口径，不是 D4 上限的口径。
    if (digest.countedLines > GATE_LIMITS.maxLines || digest.countedFiles > GATE_LIMITS.maxFiles) {
      block('size-cap', `${digest.countedLines} lines, ${digest.countedFiles} files`);
    }
    const paths = classifyPaths(compare.files, i.ticketRef);
    if (paths.protected.length > 0) block('protected-path', ...names(paths.protected));
    if (paths.outsideAutoMerge.length > 0)
      block('outside-auto-merge', ...names(paths.outsideAutoMerge));
    if (paths.deletedTests.length > 0) block('test-deleted', ...names(paths.deletedTests));
    // 证据豁免只认原样的 docs/verify/（paths.ts 用 isEvidencePath，与摘要同一条）：
    // Docs/Verify/ 下没有 patch 的名字照样列进 opaque。
    if (paths.opaque.length > 0) block('opaque-file', ...names(paths.opaque));
    if (paths.otherTicketEvidence.length > 0)
      block('evidence-outside-ticket', ...names(paths.otherTicketEvidence));
    if (paths.executableEvidence.length > 0)
      block('evidence-executable', ...names(paths.executableEvidence));
  }

  // 来源与证据链。链接要钉在本 PR 的提交上（base..head），且指向本 PR 增改的文件：
  // 只是 head 的祖先不够，main 历史里同票前一段（已 squash）的证据也是祖先，本 PR
  // 却一份证据没加。compare 不可得时上面已拦，这里判不了，不再重复列出。
  // 判不了的另一样：链接钉在本 PR 较早的提交上、文件到后来的提交才加进来时，raw
  // 是 404，可两条都成立。要判须知道每个提交动了哪些文件，compare 不给；文件在该
  // SHA 上是否存在交给 S4 的外壳查（测试「readiness 不判链接的文件……」钉着这一点）。
  if (i.issueNumber === null) block('issue-ref-missing');
  if (pr !== null && compare !== null) {
    const { links } = parseRawEvidenceLinks(pr.body, {
      owner: i.repo.owner,
      repo: i.repo.name,
      ticketRef: i.ticketRef,
    });
    const commits = new Set(compare.commits);
    const changed = new Set(
      compare.files.filter((f) => f.status !== 'removed').map((f) => f.filename),
    );
    if (!links.some((l) => commits.has(l.sha) && changed.has(l.path))) {
      block(
        'evidence-link-missing',
        `${links.length} link(s) to ${EVIDENCE_PREFIX}${i.ticketRef}/, none at a commit of this PR to a file it adds or changes`,
      );
    }
  }

  // 判定：只认绑在当前摘要上的。摘要不可得时上面已拦，这里不再重复列出。
  // 唯一的例外是 verify-tampered，有意不看摘要：本构建任何摘要上的 tampered
  // 都算。验证者改了代码是这条车道的问题，不是哪份补丁的问题，修出一份新补丁
  // 清不掉它；只有换新的构建（verdicts 只含本构建的判定）才清掉。
  if (i.verdicts.some((x) => x.kind === 'verify' && x.outcome === 'tampered'))
    block('verify-tampered');
  const perspectives = i.round?.perspectives ?? i.availability.reviewerPerspectives;
  if (D !== null) {
    const at = (kind: GateVerdictView['kind'], perspective?: string) =>
      i.verdicts.filter(
        (x) =>
          x.kind === kind &&
          x.patchDigest === D &&
          (perspective === undefined || x.perspective === perspective),
      );
    const has = (xs: GateVerdictView[], outcome: GateVerdictView['outcome']) =>
      xs.some((x) => x.outcome === outcome);

    const verify = at('verify');
    if (has(verify, 'block')) block('verify-failed');
    // 证据无效与提取失败一样：同摘要上后来有一次通过就清掉。
    if (!has(verify, 'pass') && has(verify, 'evidence_invalid')) block('verify-evidence-invalid');
    if (!has(verify, 'pass') && has(verify, 'extraction_failed')) block('verify-extraction-failed');
    if (
      !verify.some((x) =>
        ['pass', 'block', 'evidence_invalid', 'extraction_failed'].includes(x.outcome),
      )
    ) {
      // 当前补丁上只有失败的验证步（没有结论）时，单列出来，不算进「别的补丁」。
      const elsewhere = i.verdicts.filter((x) => x.kind === 'verify' && x.patchDigest !== D);
      const stepFailed = verify.filter((x) => x.outcome === 'step_failed');
      block(
        'verify-missing',
        ...(elsewhere.length > 0
          ? [`${elsewhere.length} verdict(s) on another patch or unbound`]
          : []),
        ...(stepFailed.length > 0
          ? [`${stepFailed.length} verify step(s) failed on this patch`]
          : []),
      );
    }

    const blocking = at('review').filter((x) => x.outcome === 'block');
    if (blocking.length > 0)
      block('review-blocking', ...new Set(blocking.map((x) => x.perspective ?? 'review')));
    for (const p of perspectives) {
      const mine = at('review', p);
      if (has(mine, 'pass') || has(mine, 'block')) continue;
      if (has(mine, 'extraction_failed')) block('review-extraction-failed', p);
      else block('review-missing', p);
    }

    const decision = at('decision');
    if (has(decision, 'block')) block('decision-no-go');
    else if (!has(decision, 'pass')) {
      if (has(decision, 'extraction_failed')) block('decision-extraction-failed');
      else block('decision-missing');
    }
  }
  if (i.round !== null && i.round.timedOut.length > 0)
    block('perspective-timed-out', ...i.round.timedOut);

  // 轮次与人手
  if (i.round?.fixRoundsExhausted) block('fix-rounds-exhausted');
  if (i.round?.fixNoChange) block('fix-no-change');
  if (i.round?.gateRoundsExhausted) block('gate-rounds-exhausted');
  if (perspectives.length === 0) block('no-reviewers');
  if (!i.availability.verifier) block('no-verifier');
  if (!i.availability.decider) block('no-decider');

  const blockers: MergeBlocker[] = [...found.entries()]
    .sort(([a], [b]) => (ORDER.get(a) ?? 0) - (ORDER.get(b) ?? 0))
    .map(([code, detail]) => {
      const meta = META.get(code);
      return { code, class: meta?.class ?? 'human', label: meta?.label ?? code, detail };
    });
  return {
    ready: blockers.length === 0,
    headSha: pr?.headSha ?? null,
    patchDigest: pr === null ? null : D,
    policy: i.policy.mergePolicy,
    blockers,
  };
}
