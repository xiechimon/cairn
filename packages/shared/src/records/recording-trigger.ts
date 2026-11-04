const WEB_SOURCE_PREFIX = 'apps/web/src/';
const TEST_FILE_RE = /(?:^|\/)__tests__\/|\.test\.[cm]?[jt]sx?$/;
const LOCALE_FILE_RE = /^apps\/web\/src\/i18n\//;
const MOTION_TOKEN_PATHS = ['apps/web/src/styles/motion.css'] as const;

export const RECORDING_EXTENSIONS = Object.freeze(['.gif', '.webm', '.mp4']);
export const RECORDING_MAX_BYTES = 5 * 1024 * 1024;

const TRIGGERS = Object.freeze([
  Object.freeze({ name: 'transition', re: /(?<![\w-])transition(?![\w-])/i }),
  Object.freeze({ name: 'animation', re: /(?<![\w-])animation(?:-name)?(?![\w-])/i }),
  Object.freeze({ name: 'keyframes', re: /@keyframes(?![\w-])/i }),
  Object.freeze({ name: 'motion', re: /(?<![\w-])motion(?![\w-])/i }),
  Object.freeze({
    name: 'drag',
    re: /(?<![\w-])on(?:Drag\w*|PointerMove|TouchMove)\s*=|(?<![\w-])draggable(?![\w-])/i,
  }),
  Object.freeze({
    name: 'hover',
    re: /(?<![\w-])on(?:Mouse\w+|Pointer(?:Enter|Leave|Over|Out)|Hover\w*)\s*=|(?<![\w-])hover:/i,
  }),
  Object.freeze({
    name: 'press',
    re: /(?<![\w-])on(?:Mouse|Pointer|Touch)(?:Down|Up|Start|End|Cancel)\s*=/i,
  }),
  Object.freeze({
    name: 'scripted motion',
    re: /scroll-behavior\s*:\s*smooth|\.style\.(?:transform|transition|scrollBehavior)\s*=/i,
  }),
]);

export type RecordingTriggerName = (typeof TRIGGERS)[number]['name'];

export interface RecordingFileInput {
  path: string;
  addedLines: readonly string[];
}

export interface RecordingRequirement {
  required: boolean;
  reasons: string[];
}

export const isMotionTokenPath = (path: string): boolean =>
  (MOTION_TOKEN_PATHS as readonly string[]).includes(path);

export function recordingRequired(files: readonly RecordingFileInput[]): RecordingRequirement {
  const reasons: string[] = [];
  for (const file of files) {
    if (
      !file.path.startsWith(WEB_SOURCE_PREFIX) ||
      TEST_FILE_RE.test(file.path) ||
      LOCALE_FILE_RE.test(file.path)
    )
      continue;
    for (const line of file.addedLines) {
      const text = line.trim();
      if (text === '') continue;
      const name: RecordingTriggerName | 'motion token' | undefined = isMotionTokenPath(file.path)
        ? 'motion token'
        : TRIGGERS.find((t) => t.re.test(text))?.name;
      if (name !== undefined) reasons.push(`${file.path}: ${text} (${name})`);
    }
  }
  return { required: reasons.length > 0, reasons };
}

export function recordingRequirements(
  files: readonly {
    filename: string;
    status: string;
    patch?: string | null;
  }[],
): RecordingRequirement {
  return recordingRequired(
    files
      .filter((f) => f.status !== 'removed')
      .map((f) => ({
        path: f.filename,
        addedLines: (f.patch ?? '')
          .split('\n')
          .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
          .map((line) => line.slice(1)),
      })),
  );
}

export const isRecordingPath = (path: string): boolean =>
  RECORDING_EXTENSIONS.some((extension) => path.toLowerCase().endsWith(extension));

export { MOTION_TOKEN_PATHS, TRIGGERS };
