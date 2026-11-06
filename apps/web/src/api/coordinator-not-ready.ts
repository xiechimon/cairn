import { COORDINATOR_NOT_READY } from '@cairn/shared';
import { ApiError } from './client.js';

export function isCoordinatorNotReady(error: unknown): boolean {
  return error instanceof ApiError && error.reason === COORDINATOR_NOT_READY;
}
