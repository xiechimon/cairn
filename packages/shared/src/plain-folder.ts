export const PLAIN_FOLDER_HUGE_BYTES = 2 * 1024 * 1024 * 1024;
export const PLAIN_FOLDER_GIT_TIMEOUT_MS = 120_000;
export const CACHEDIR_TAG_SIGNATURE = 'Signature: 8a477f597d28d172789f06886806bc55';

export const PLAIN_FOLDER_EXCLUDES = `# cairn plain-folder excludes, never snapshotted
.git/
.svn/
.hg/
.cairn-readonly-export
.cairn-plain-folder.json
node_modules/
bower_components/
.pnpm-store/
.venv/
venv/
.direnv/
__pycache__/
.pytest_cache/
.mypy_cache/
.ruff_cache/
.tox/
.gradle/
Pods/
dist/
build/
out/
.next/
.nuxt/
.output/
.svelte-kit/
target/
coverage/
.cache/
.parcel-cache/
.turbo/
.vite/
.terraform/
*.log
logs/
*.tmp
*.swp
.DS_Store
Thumbs.db
*.env*
.env
.env.*
*.pem
*.key
*.jpg
*.jpeg
*.png
*.gif
*.bmp
*.tiff
*.webp
*.ico
*.icns
*.psd
*.mp3
*.wav
*.flac
*.ogg
*.mp4
*.mov
*.avi
*.mkv
*.webm
*.zip
*.tar
*.gz
*.tgz
*.bz2
*.xz
*.7z
*.rar
*.jar
*.iso
*.dmg
*.sqlite
*.sqlite3
*.db
*.parquet
*.onnx
*.safetensors
*.gguf
`;

const EXCLUDED_DIR_NAMES = new Set([
  '.git',
  '.svn',
  '.hg',
  'node_modules',
  'bower_components',
  '.pnpm-store',
  '.venv',
  'venv',
  '.direnv',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.ruff_cache',
  '.tox',
  '.gradle',
  'Pods',
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  '.output',
  '.svelte-kit',
  'target',
  'coverage',
  '.cache',
  '.parcel-cache',
  '.turbo',
  '.vite',
  '.terraform',
  'logs',
]);

const EXCLUDED_FILE_NAMES = new Set([
  '.cairn-readonly-export',
  '.cairn-plain-folder.json',
  '.ds_store',
  'thumbs.db',
  '.env',
]);

const EXCLUDED_EXTENSIONS = new Set([
  'log',
  'tmp',
  'swp',
  'pem',
  'key',
  'jpg',
  'jpeg',
  'png',
  'gif',
  'bmp',
  'tiff',
  'webp',
  'ico',
  'icns',
  'psd',
  'mp3',
  'wav',
  'flac',
  'ogg',
  'mp4',
  'mov',
  'avi',
  'mkv',
  'webm',
  'zip',
  'tar',
  'gz',
  'tgz',
  'bz2',
  'xz',
  '7z',
  'rar',
  'jar',
  'iso',
  'dmg',
  'sqlite',
  'sqlite3',
  'db',
  'parquet',
  'onnx',
  'safetensors',
  'gguf',
]);

export function isPlainFolderExcluded(relPath: string, isDir: boolean): boolean {
  const parts = relPath.split('/').filter(Boolean);
  if (parts.length === 0) return false;
  const checkDirs = isDir ? parts : parts.slice(0, -1);
  for (const dir of checkDirs) {
    if (EXCLUDED_DIR_NAMES.has(dir)) return true;
  }
  if (isDir) return false;
  const base = parts.at(-1) ?? '';
  const lower = base.toLowerCase();
  if (EXCLUDED_FILE_NAMES.has(lower)) return true;
  if (lower.includes('.env')) return true;
  const dot = lower.lastIndexOf('.');
  if (dot <= 0) return false;
  return EXCLUDED_EXTENSIONS.has(lower.slice(dot + 1));
}
