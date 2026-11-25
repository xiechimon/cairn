import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const UPDATER_LABEL = 'app.cairn.updater';
export const UPDATER_ENTRY = 'background-updater.mjs';
export const BUNDLE_ID = 'io.github.xiechimon.cairn';
const RUN_OR_REMOVE =
  'if [ -x "$1" ]; then exec "$1" "$2"; fi; /bin/rm -f "$3"; exec /bin/launchctl bootout "gui/$(/usr/bin/id -u)/$4"';

export interface UpdaterAgentPaths {
  executablePath: string;
  entry: string;
  userData: string;
  plistPath: string;
  label?: string;
}

export function updaterPlistPath(homeDir: string): string {
  return join(homeDir, 'Library', 'LaunchAgents', `${UPDATER_LABEL}.plist`);
}

export function checkMinute(userData: string): number {
  return createHash('sha256').update(userData).digest().readUInt8(0) % 30;
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

export function buildUpdaterPlist(paths: UpdaterAgentPaths): string {
  const label = paths.label ?? UPDATER_LABEL;
  const minute = checkMinute(paths.userData);
  const log = join(paths.userData, 'logs', 'background-updater.log');
  const text = (value: string): string => `<string>${escapeXml(value)}</string>`;
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    '  <key>Label</key>',
    `  ${text(label)}`,
    '  <key>AssociatedBundleIdentifiers</key>',
    `  <array>${text(BUNDLE_ID)}</array>`,
    '  <key>ProgramArguments</key>',
    '  <array>',
    ...[
      '/bin/sh',
      '-c',
      RUN_OR_REMOVE,
      'cairn-updater',
      paths.executablePath,
      paths.entry,
      paths.plistPath,
      label,
    ].map((arg) => `    ${text(arg)}`),
    '  </array>',
    '  <key>EnvironmentVariables</key>',
    '  <dict>',
    '    <key>ELECTRON_RUN_AS_NODE</key>',
    '    <string>1</string>',
    '    <key>CAIRN_USER_DATA</key>',
    `    ${text(paths.userData)}`,
    '  </dict>',
    '  <key>StartCalendarInterval</key>',
    '  <array>',
    ...[minute, minute + 30].map(
      (at) => `    <dict><key>Minute</key><integer>${at}</integer></dict>`,
    ),
    '  </array>',
    '  <key>ProcessType</key>',
    '  <string>Background</string>',
    '  <key>LimitLoadToSessionType</key>',
    '  <string>Aqua</string>',
    '  <key>StandardOutPath</key>',
    `  ${text(log)}`,
    '  <key>StandardErrorPath</key>',
    `  ${text(log)}`,
    '</dict>',
    '</plist>',
    '',
  ].join('\n');
}

export async function ensureUpdaterAgent(
  paths: UpdaterAgentPaths,
  runLaunchctl: (args: string[]) => Promise<void> = async (args) => {
    await execFileAsync('launchctl', args);
  },
  uid: number = process.getuid?.() ?? 501,
): Promise<'unchanged' | 'installed'> {
  const plist = buildUpdaterPlist(paths);
  let current: string | null = null;
  try {
    current = readFileSync(paths.plistPath, 'utf8');
  } catch {}
  if (current === plist) return 'unchanged';
  mkdirSync(dirname(paths.plistPath), { recursive: true });
  mkdirSync(join(paths.userData, 'logs'), { recursive: true, mode: 0o700 });
  writeFileSync(paths.plistPath, plist, 'utf8');
  const domain = `gui/${uid}`;
  await runLaunchctl(['bootout', `${domain}/${paths.label ?? UPDATER_LABEL}`]).catch(() => {});
  await runLaunchctl(['bootstrap', domain, paths.plistPath]);
  return 'installed';
}
