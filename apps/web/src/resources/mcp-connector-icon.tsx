import { Cloudflare, Github, HuggingFace, MCP, Notion } from '@lobehub/icons';
import { useLayoutEffect, useRef } from 'react';

const BRAND_ICONS: Record<string, typeof MCP> = {
  github: Github,
  cloudflare: Cloudflare,
  huggingface: HuggingFace,
  notion: Notion,
};

export function McpConnectorIcon({ catalogId }: { catalogId: string | null }) {
  const ref = useRef<HTMLSpanElement>(null);
  const Icon = (catalogId !== null ? BRAND_ICONS[catalogId] : undefined) ?? MCP;
  useLayoutEffect(() => {
    for (const node of ref.current?.querySelectorAll('title') ?? []) node.remove();
  }, [catalogId]);
  return (
    <span
      ref={ref}
      aria-hidden
      className="flex size-5 flex-none items-center justify-center text-content-secondary"
    >
      <Icon size={18} />
    </span>
  );
}
