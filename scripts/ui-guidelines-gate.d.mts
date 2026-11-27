export interface UiGuidelineViolation {
  rule: string;
  file: string;
  line: number;
  message: string;
}

export interface UiGuidelineResult {
  ok: boolean;
  violations: UiGuidelineViolation[];
}

export function checkUiGuidelines(options?: {
  root?: string;
  files?: Record<string, string> | null;
  isolated?: boolean;
}): UiGuidelineResult;
