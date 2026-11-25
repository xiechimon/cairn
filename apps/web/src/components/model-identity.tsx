import { formatModelDisplayName, parseModelKey } from '@cairn/shared';
import { cn } from 'cn';
import { Box } from 'lucide-react';
import type { ComponentType, SVGProps } from 'react';
import type { ModelOption } from '../fixtures/records.js';
import { LOBEHUB_MONO } from '../icons/lobehub-mono.js';
import { presetMarkOf } from '../resources/provider-preset-icon.js';
import {
  AntigravityMark,
  ClaudeCodeMark,
  ClaudeMark,
  DevinMark,
  GeminiMark,
  GrokMark,
  OpenAIMark,
  PiMark,
} from './brand-marks.js';
import { MachineIcon } from './machine-label.js';

export type MarkComponent = ComponentType<SVGProps<SVGSVGElement>>;

function createMonoMark(id: keyof typeof LOBEHUB_MONO): MarkComponent {
  const mark = LOBEHUB_MONO[id];
  return function MonoBrandMark({ width = 16, height = 16, ...props }: SVGProps<SVGSVGElement>) {
    return (
      <svg
        aria-hidden="true"
        width={width}
        height={height}
        viewBox={mark.viewBox}
        fill="currentColor"
        fillRule="evenodd"
        clipRule="evenodd"
        {...props}
      >
        {mark.paths.map((d) => (
          <path key={d} d={d} />
        ))}
      </svg>
    );
  };
}

const MONO_MARKS = {
  deepseek: createMonoMark('deepseek'),
  minimax: createMonoMark('minimax'),
  qwen: createMonoMark('qwen'),
  zhipu: createMonoMark('zhipu'),
  moonshot: createMonoMark('moonshot'),
  mistral: createMonoMark('mistral'),
  xiaomimimo: createMonoMark('xiaomimimo'),
} as const satisfies Record<string, MarkComponent>;

export function engineRuntimeOf(engineOrRuntime: string | null | undefined): string | null {
  if (engineOrRuntime == null) return null;
  const norm = engineOrRuntime.trim().toLowerCase();
  if (norm === 'claude-code' || norm === 'claude code') return 'claude-code';
  if (norm === 'devin') return 'devin';
  if (norm === 'antigravity') return 'antigravity';
  if (norm === 'gemini') return 'gemini';
  if (norm === 'codex') return 'codex';
  if (norm === 'pi' || norm === 'cairn') return 'pi';
  return null;
}

export function engineMarkFor(engineOrRuntime: string | null | undefined): MarkComponent {
  const runtime = engineRuntimeOf(engineOrRuntime);
  if (runtime === 'claude-code') return ClaudeCodeMark;
  if (runtime === 'devin') return DevinMark;
  if (runtime === 'antigravity') return AntigravityMark;
  if (runtime === 'gemini') return GeminiMark;
  if (runtime === 'codex') return OpenAIMark;
  if (runtime === 'pi') return PiMark;
  return Box;
}

function markFromProviderId(provider: string): MarkComponent | null {
  const preset = presetMarkOf(provider);
  if (preset !== undefined) return preset;
  const lower = provider.toLowerCase();
  if (lower.includes('claude-code')) return ClaudeCodeMark;
  if (lower.includes('anthropic') || lower.includes('claude')) return ClaudeMark;
  if (lower.includes('openai')) return OpenAIMark;
  if (lower.includes('google') || lower.includes('gemini')) return GeminiMark;
  if (lower.includes('deepseek')) return MONO_MARKS.deepseek;
  if (lower.includes('minimax')) return MONO_MARKS.minimax;
  if (lower.includes('qwen')) return MONO_MARKS.qwen;
  if (lower.includes('zhipu') || lower.includes('glm')) return MONO_MARKS.zhipu;
  if (lower.includes('moonshot') || lower.includes('kimi')) return MONO_MARKS.moonshot;
  if (lower.includes('mistral')) return MONO_MARKS.mistral;
  if (lower.includes('xiaomi') || lower.includes('mimo')) return MONO_MARKS.xiaomimimo;
  if (lower.includes('xai') || lower.includes('grok')) return GrokMark;
  if (lower.includes('devin')) return DevinMark;
  if (lower.includes('antigravity')) return AntigravityMark;
  return null;
}

export function modelMarkFor({
  modelId,
  provider,
  runtime,
}: {
  modelId?: string | null;
  provider?: string | null;
  runtime?: string | null;
}): MarkComponent {
  const raw = (modelId ?? '').trim();
  const parsed = raw !== '' && raw.includes('/') ? parseModelKey(raw) : null;
  const effectiveId = (parsed?.modelId ?? raw).toLowerCase();
  const effectiveProvider = (provider ?? parsed?.provider ?? '').trim();
  const effectiveRuntime = engineRuntimeOf(runtime);

  if (effectiveRuntime === 'devin') return DevinMark;
  if (effectiveRuntime === 'antigravity') return AntigravityMark;

  if (effectiveId.includes('claude')) return ClaudeMark;
  if (effectiveId.startsWith('devin') || effectiveId.includes('swe-')) return DevinMark;
  if (effectiveId.includes('antigravity')) return AntigravityMark;
  if (effectiveId.includes('gemini')) return GeminiMark;
  if (effectiveId.includes('grok')) return GrokMark;
  if (/^(gpt|o\d|codex|chatgpt)/.test(effectiveId)) return OpenAIMark;
  if (effectiveId.includes('deepseek')) return MONO_MARKS.deepseek;
  if (effectiveId.includes('minimax')) return MONO_MARKS.minimax;
  if (effectiveId.includes('qwen')) return MONO_MARKS.qwen;
  if (/^(glm|chatglm|zhipu)/.test(effectiveId)) return MONO_MARKS.zhipu;
  if (/^(kimi|moonshot)/.test(effectiveId)) return MONO_MARKS.moonshot;
  if (/^(mistral|codestral|pixtral|ministral)/.test(effectiveId)) return MONO_MARKS.mistral;
  if (/^(mimo|xiaomi)/.test(effectiveId)) return MONO_MARKS.xiaomimimo;

  if (effectiveRuntime === 'claude-code') return ClaudeCodeMark;
  if (effectiveRuntime === 'gemini') return GeminiMark;
  if (effectiveRuntime === 'codex') return OpenAIMark;

  if (effectiveProvider !== '') {
    const providerMark = markFromProviderId(effectiveProvider);
    if (providerMark !== null) return providerMark;
  }
  return Box;
}

export interface ClientModelIdentity {
  raw: string;
  provider: string | null;
  providerLabel: string | null;
  modelId: string;
  modelName: string;
  runtime: string | null;
}

export function resolveModelClientEntry(
  rawModel: string,
  {
    providerHint,
    options,
  }: {
    providerHint?: string | null;
    options?: readonly ModelOption[];
  } = {},
): ClientModelIdentity {
  const parsed = parseModelKey(rawModel);
  const provider = parsed.provider ?? (providerHint && providerHint !== '' ? providerHint : null);
  const exact =
    provider !== null
      ? options?.find((opt) => opt.provider === provider && opt.modelId === parsed.modelId)
      : undefined;
  const byModelId =
    exact ??
    (() => {
      const hits = options?.filter((opt) => opt.modelId === parsed.modelId) ?? [];
      return hits.length === 1 ? hits[0] : undefined;
    })();
  const resolvedProvider = provider ?? byModelId?.provider ?? null;
  const resolvedRuntime = byModelId?.runtime ?? engineRuntimeOf(resolvedProvider);
  return {
    raw: rawModel,
    provider: resolvedProvider,
    providerLabel: byModelId?.providerLabel ?? resolvedProvider,
    modelId: parsed.modelId,
    modelName: byModelId?.modelName ?? formatModelDisplayName(parsed.modelId),
    runtime: resolvedRuntime,
  };
}

export function EngineMark({
  engine,
  runtime,
  className,
}: {
  engine?: string | null;
  runtime?: string | null;
  className?: string;
}) {
  const Mark = engineMarkFor(runtime ?? engine);
  return <Mark aria-hidden="true" className={cn('size-4 flex-none', className)} />;
}

export function EngineLabel({
  engine,
  runtime,
  className,
}: {
  engine: string;
  runtime?: string | null;
  className?: string;
}) {
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1.5', className)}>
      <EngineMark engine={engine} runtime={runtime} />
      <span className="min-w-0 truncate">{engine}</span>
    </span>
  );
}

export function ModelMark({
  modelId,
  provider,
  runtime,
  className,
}: {
  modelId?: string | null;
  provider?: string | null;
  runtime?: string | null;
  className?: string;
}) {
  const Mark = modelMarkFor({ modelId, provider, runtime });
  return <Mark aria-hidden="true" className={cn('size-4 flex-none', className)} />;
}

export function ModelLabel({
  modelId,
  modelName,
  provider,
  runtime,
  className,
}: {
  modelId: string;
  modelName?: string | null;
  provider?: string | null;
  runtime?: string | null;
  className?: string;
}) {
  const label = modelName && modelName !== '' ? modelName : formatModelDisplayName(modelId);
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1.5', className)}>
      <ModelMark modelId={modelId} provider={provider} runtime={runtime} />
      <span className="min-w-0 truncate">{label}</span>
    </span>
  );
}

export function RunnerLabel({
  machine,
  className,
}: {
  machine: {
    id?: string | null;
    name: string;
    osPlatform?: string | null;
    osDistribution?: string | null;
  };
  className?: string;
}) {
  const osPlatform =
    machine.osPlatform === 'darwin'
      ? ('darwin' as const)
      : machine.osPlatform === 'windows'
        ? ('windows' as const)
        : machine.osPlatform === 'linux'
          ? ('linux' as const)
          : undefined;
  const capabilities =
    osPlatform !== undefined
      ? { osPlatform, osDistribution: machine.osDistribution ?? undefined }
      : undefined;
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1.5', className)}>
      <MachineIcon
        machine={{ id: machine.id ?? null, name: machine.name, capabilities }}
        className="size-4 text-content-secondary"
      />
      <span className="min-w-0 truncate">{machine.name}</span>
    </span>
  );
}
