import {
  ATTACHMENT_MAX_BYTES,
  REPO_ARCHIVE_FAILED_FILE_NAME,
  REPO_ARCHIVE_FILE_NAME,
  SESSION_FILE_NAME,
  SESSION_JSONL_MAX_BYTES,
} from '@cairn/shared';
import type { Context, MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { routePath } from 'hono/route';
import { INFO_SNAPSHOT_MAX_BYTES } from '../services/info-repo-snapshot.js';

const KIB = 1024;
const MIB = 1024 * KIB;
const DEFAULT_BODY_BYTES = 2 * MIB;
const MULTIPART_BODY_BYTES = ATTACHMENT_MAX_BYTES + 64 * KIB;

function budgetOf(c: Context): number {
  const upload = c.get('machineUpload');
  if (upload !== undefined) {
    switch (upload.name) {
      case REPO_ARCHIVE_FILE_NAME:
        return 4 * Math.ceil(INFO_SNAPSHOT_MAX_BYTES / 3);
      case SESSION_FILE_NAME:
        return SESSION_JSONL_MAX_BYTES;
      case REPO_ARCHIVE_FAILED_FILE_NAME:
        return DEFAULT_BODY_BYTES;
      default:
        return 32 * MIB;
    }
  }

  switch (routePath(c, -1)) {
    case '/api/webhook/github/:token':
      return 256 * KIB;
    case '/api/teams/:teamId/computers/:computerId/screen':
    case '/api/teams/:teamId/computers/:computerId/control':
      return 4 * KIB;
    case '/api/machine/orbs/closed':
    case '/api/machine/upload-urls/:stepId':
      return 64 * KIB;
    case '/api/machine/done/:stepId':
    case '/api/machine/tool/:stepId':
      return 16 * MIB;
    case '/api/machine/computer/:callId':
    case '/api/machine/im/:connId/event':
      return 24 * MIB;
    case '/api/uploads/upload':
      return MULTIPART_BODY_BYTES;
    case '/api/todos/:id/design/marks':
      return 8 * MIB;
    case '/api/skills':
      return c.req.method === 'POST' ? 12 * MIB : DEFAULT_BODY_BYTES;
    case '/api/teams/:id/skills/:sid':
      return c.req.method === 'PUT' ? 12 * MIB : DEFAULT_BODY_BYTES;
    default:
      return DEFAULT_BODY_BYTES;
  }
}

export const limitApiRequestBody: MiddlewareHandler = (c, next) =>
  bodyLimit({
    maxSize: budgetOf(c),
    onError: (c) =>
      routePath(c, -1) === '/api/uploads/upload'
        ? c.json({ error: `invalid size: must be 0..${ATTACHMENT_MAX_BYTES}` }, 400)
        : c.json({ error: 'request body too large' }, 413),
  })(c, next);
