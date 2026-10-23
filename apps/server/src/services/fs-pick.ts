// 原生文件夹选取（ADR 0003 D1-D4/D7，#440）：server 进程代弹 macOS 原生
// choose folder 对话框——浏览器物理上拿不到本地绝对路径（showDirectoryPicker
// 只给句柄），对话框只能由目标机上的进程弹。机器语义 = server 机（D2，与
// validateLocalRepoPath 创建校验同机同语义）；v1 仅 macOS（D3，platform
// dispatch 缝在本模块内收口）。
//
// 失败方式清单钉在 #440 评论（S1-S14），实现让场景通过：
// - 探测必须 spawn 前置（S2 实测：Background 会话域下 choose folder 不报错、
//   静默挂死，事后判不可行）——darwin + `launchctl managername` = Aqua。
// - 取消分类靠 AppleScript error number -128，不吃 stderr 文案（实测中文域
//   输出「用户已取消」，文案匹配是脆弱契约）。
// - 结构化 stdout（PATH:/ERR: 前缀）+ 全量解析：路径含空格/内嵌换行免疫（S4）。
// - 单飞（S6/D7）+ watchdog 兜底探测通过后仍挂死的极端态（S5/S9）+
//   shutdown 收在飞子进程（S7，逃逸进程回归是仓既有纪律）。

import { type ChildProcess, spawn } from 'node:child_process';
import { HttpError } from '../lib/errors.js';

/** 在飞对话框 watchdog（S5/S9）：探测通过但 WindowServer 实际不可用 = 静默
 *  挂死，到期 kill 并释放单飞锁。10min = 人机交互宽放上限；真超时归入
 *  unavailable（细节进 server 日志面）。 */
const WATCHDOG_MS = 10 * 60 * 1000;

/** 单飞锁（D7）：同一时刻至多一个对话框在飞，模块级 = server 进程级。 */
let inFlight: ChildProcess | null = null;

/** server 关停收在飞子进程（index.ts SIGINT/SIGTERM 面调用，S7）——否则
 *  Background 域挂死实测同款孤儿 osascript 逃逸（仓有回归测试先例）。 */
export function killInFlightPick(): void {
  if (inFlight !== null) {
    inFlight.kill('SIGKILL');
    inFlight = null;
  }
}

/** 能力探测（S1/S2，D3/D4）：darwin + GUI 会话域。managername 是会话域
 *  真值（Aqua = 可弹对话框；Background = ssh/launchd/后台域，弹了也没人看
 *  且实测挂死）。launchctl 缺失/spawn 失败 = 探测不过，同归 unavailable。 */
function probeGuiSession(): Promise<boolean> {
  if (process.platform !== 'darwin') return Promise.resolve(false);
  return new Promise((resolve) => {
    const child = spawn('launchctl', ['managername']);
    let out = '';
    child.stdout.on('data', (d: Buffer) => {
      out += d.toString();
    });
    child.on('error', () => resolve(false));
    child.on('close', () => resolve(out.trim() === 'Aqua'));
  });
}

/** 弹原生对话框并等结局。返回：绝对路径 = 选中；null = 用户取消（S3，
 *  正常结局非错误）。抛：422 unavailable（S1/S2/S5/S8/S9）/ 409 busy（S6），
 *  reason 词汇单源 = shared FS_PICK_ERROR_REASONS。 */
export async function pickFolder(): Promise<string | null> {
  if (!(await probeGuiSession())) {
    throw new HttpError(
      422,
      'folder picker unavailable: requires macOS with a GUI session',
      'unavailable',
    );
  }
  if (inFlight !== null) {
    throw new HttpError(409, 'a folder pick is already in flight', 'busy');
  }
  // AppleScript try 包裹：取消（-128）与其余运行时错误都走结构化 stdout，
  // 退出码/本地化 stderr 不参与分类。
  const script = [
    'try',
    'return "PATH:" & (POSIX path of (choose folder with prompt "cairn · 选择项目文件夹"))',
    'on error errStr number errNum',
    'return "ERR:" & errNum',
    'end try',
  ];
  const child = spawn(
    'osascript',
    script.flatMap((line) => ['-e', line]),
  );
  inFlight = child;
  let watchdogFired = false;
  const watchdog = setTimeout(() => {
    watchdogFired = true;
    child.kill('SIGKILL');
  }, WATCHDOG_MS);
  try {
    const { stdout, stderr } = await new Promise<{ stdout: string; stderr: string }>(
      (resolve, reject) => {
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (d: Buffer) => {
          stdout += d.toString();
        });
        child.stderr.on('data', (d: Buffer) => {
          stderr += d.toString();
        });
        // spawn 失败（ENOENT 等，S8）走 error 事件；close 恒随后到。
        child.on('error', reject);
        child.on('close', () => resolve({ stdout, stderr }));
      },
    );
    if (watchdogFired) {
      throw new HttpError(422, 'folder pick timed out (watchdog)', 'unavailable');
    }
    // 全量 stdout 解析，仅 trim 末尾换行——路径含内嵌换行时前缀切分仍正确。
    const out = stdout.replace(/\n$/, '');
    if (out.startsWith('PATH:')) return out.slice('PATH:'.length);
    if (out === 'ERR:-128') return null;
    throw new HttpError(
      422,
      `folder pick failed: ${stderr.trim() || out || 'unknown osascript outcome'}`,
      'unavailable',
    );
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(422, `folder picker unavailable: ${(err as Error).message}`, 'unavailable');
  } finally {
    clearTimeout(watchdog);
    inFlight = null;
  }
}
