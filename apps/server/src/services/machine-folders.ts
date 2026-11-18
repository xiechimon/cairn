import type {
  MachineFolderGrants,
  MachineFolderPin,
  MachineFolderPinOp,
  MachineFolderPinReport,
  MachineFoldersReport,
  MachinePresencePin,
} from '@cairn/shared';
import { MACHINE_FOLDER_PINS_LIMIT } from '@cairn/shared';
import { HttpError } from '../lib/errors.js';

function isAbsoluteForm(path: string): boolean {
  return path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path);
}

function hasTraversal(path: string): boolean {
  return path.split(/[\\/]+/).some((segment) => segment === '..');
}

function isRootOnly(path: string): boolean {
  return /^([/\\]|[A-Za-z]:[/\\]?|~[/\\]?)$/.test(path);
}

export function validReportedAbsolute(path: string): boolean {
  return isAbsoluteForm(path) && !hasTraversal(path) && !isRootOnly(path);
}

export function validPinPathInput(path: string): boolean {
  const homeForm = path === '~' || path.startsWith('~/') || path.startsWith('~\\');
  return (homeForm || isAbsoluteForm(path)) && !hasTraversal(path) && !isRootOnly(path);
}

function applyPinReport(
  pin: MachineFolderPin,
  report: MachineFolderPinReport,
  grants: MachineFolderGrants,
): void {
  if (report.status !== 'confirmed') {
    if (pin.status === 'confirmed') {
      pin.status = 'absent';
      pin.enabled = false;
    } else {
      pin.status = 'rejected';
      pin.enabled = false;
    }
    return;
  }
  const canonical = report.canonicalPath;
  if (canonical === undefined || !validReportedAbsolute(canonical)) return;
  const collides =
    canonical === grants.workspacesDir ||
    grants.pins.some(
      (other) =>
        other !== pin &&
        other.path === canonical &&
        (other.status === 'confirmed' || other.status === 'pending'),
    );
  if (collides) {
    pin.status = 'rejected';
    pin.enabled = false;
    return;
  }
  pin.path = canonical;
  pin.status = 'confirmed';
}

export function applyFolderReport(
  previous: MachineFolderGrants | null,
  folders: MachineFoldersReport,
): MachineFolderGrants {
  const grants: MachineFolderGrants = {
    pins: (previous?.pins ?? []).map((pin) => ({ ...pin })),
    ...(previous?.workspacesDir !== undefined ? { workspacesDir: previous.workspacesDir } : {}),
    ...(folders.bindsGrants === true ? { bindsGrants: true } : {}),
  };
  if (folders.workspacesDir !== undefined && validReportedAbsolute(folders.workspacesDir)) {
    grants.workspacesDir = folders.workspacesDir;
  }
  for (const report of folders.pins ?? []) {
    const pin = grants.pins.find((p) => p.path === report.pin);
    if (pin !== undefined) applyPinReport(pin, report, grants);
  }
  return grants;
}

export function folderPinsForPresence(
  grants: MachineFolderGrants | null,
): MachinePresencePin[] | undefined {
  const pins = (grants?.pins ?? [])
    .flatMap((pin) =>
      pin.status === 'pending' || pin.status === 'confirmed'
        ? [{ path: pin.path, status: pin.status, enabled: pin.enabled }]
        : [],
    )
    .slice(0, MACHINE_FOLDER_PINS_LIMIT);
  return pins.length > 0 ? pins : undefined;
}

export function applyFolderPinOps(
  previous: MachineFolderGrants | null,
  ops: readonly MachineFolderPinOp[],
): MachineFolderGrants {
  const grants: MachineFolderGrants = {
    pins: (previous?.pins ?? []).map((pin) => ({ ...pin })),
    ...(previous?.workspacesDir !== undefined ? { workspacesDir: previous.workspacesDir } : {}),
    ...(previous?.bindsGrants === true ? { bindsGrants: true } : {}),
  };
  for (const { path, op } of ops) {
    if (path === grants.workspacesDir) {
      throw new HttpError(409, 'the workspaces dir is always enabled');
    }
    const pin = grants.pins.find((p) => p.path === path);
    if (op === 'pin') {
      if (!validPinPathInput(path)) {
        throw new HttpError(400, 'folder path must be absolute and contain no traversal');
      }
      if (pin !== undefined) {
        if (pin.status === 'pending' || pin.status === 'confirmed') {
          throw new HttpError(409, 'folder is already pinned');
        }
        pin.status = 'pending';
        pin.enabled = false;
        continue;
      }
      if (grants.pins.length >= MACHINE_FOLDER_PINS_LIMIT) {
        throw new HttpError(409, 'folder pin limit reached');
      }
      grants.pins.push({ path, status: 'pending', enabled: false });
      continue;
    }
    if (pin === undefined) throw new HttpError(404, 'folder pin not found');
    if (op === 'remove') {
      grants.pins.splice(grants.pins.indexOf(pin), 1);
      continue;
    }
    if (op === 'disable') {
      pin.enabled = false;
      continue;
    }
    if (pin.status === 'confirmed' && grants.bindsGrants === true) {
      pin.enabled = true;
      continue;
    }
    throw new HttpError(
      409,
      pin.status === 'confirmed'
        ? 'step launch cannot bind extra folders yet'
        : 'folder is not confirmed on this machine',
    );
  }
  return grants;
}
