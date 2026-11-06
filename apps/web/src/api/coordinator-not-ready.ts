import { COORDINATOR_NOT_READY } from '@cairn/shared';
import { toast } from 'sonner';
import { ApiError } from './client.js';

export function isCoordinatorNotReady(error: unknown): boolean {
  return error instanceof ApiError && error.reason === COORDINATOR_NOT_READY;
}

export function toastCoordinatorNotReady(title: string, hint: string): void {
  toast.error(title, { description: hint });
}
