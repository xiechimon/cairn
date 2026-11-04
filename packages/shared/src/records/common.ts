import { z } from 'zod';
import { PHASE_VALUES } from '../phase.js';

export const epochMs = z.number().int();

export const recordId = z.string();

export const phaseSchema = z.enum(PHASE_VALUES);
