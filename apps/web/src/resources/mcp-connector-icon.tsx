import type { ComponentType } from 'react';
import { LOBEHUB_MONO } from '../icons/lobehub-mono.js';

type BrandIcon = ComponentType<{ size?: number }>;

function lobehubMark(mark: { viewBox: string; paths: readonly string[] }): BrandIcon {
  return function LobehubMark({ size }: { size?: number }) {
    return (
      <svg
        width={size}
        height={size}
        viewBox={mark.viewBox}
        fill="currentColor"
        fillRule="evenodd"
        clipRule="evenodd"
        aria-hidden
      >
        {mark.paths.map((d) => (
          <path key={d} d={d} />
        ))}
      </svg>
    );
  };
}

function brandMark(viewBox: string, paths: readonly string[]): BrandIcon {
  return function BrandMark({ size }: { size?: number }) {
    return (
      <svg width={size} height={size} viewBox={viewBox} fill="currentColor" aria-hidden>
        {paths.map((d) => (
          <path key={d} d={d} />
        ))}
      </svg>
    );
  };
}

const Linear = brandMark('0 0 24 24', [
  'M2.886 4.18A11.982 11.982 0 0 1 11.99 0C18.624 0 24 5.376 24 12.009c0 3.64-1.62 6.903-4.18 9.105L2.887 4.18ZM1.817 5.626l16.556 16.556c-.524.33-1.075.62-1.65.866L.951 7.277c.247-.575.537-1.126.866-1.65ZM.322 9.163l14.515 14.515c-.71.172-1.443.282-2.195.322L0 11.358a12 12 0 0 1 .322-2.195Zm-.17 4.862 9.823 9.824a12.02 12.02 0 0 1-9.824-9.824Z',
]);

const Sentry = brandMark('0 0 24 24', [
  'M13.91 2.505c-.873-1.448-2.972-1.448-3.844 0L6.904 7.92a15.478 15.478 0 0 1 8.53 12.811h-2.221A13.301 13.301 0 0 0 5.784 9.814l-2.926 5.06a7.65 7.65 0 0 1 4.435 5.848H2.194a.365.365 0 0 1-.298-.534l1.413-2.402a5.16 5.16 0 0 0-1.614-.913L.296 19.275a2.182 2.182 0 0 0 .812 2.999 2.24 2.24 0 0 0 1.086.288h6.983a9.322 9.322 0 0 0-3.845-8.318l1.11-1.922a11.47 11.47 0 0 1 4.95 10.24h5.915a17.242 17.242 0 0 0-7.885-15.28l2.244-3.845a.37.37 0 0 1 .504-.13c.255.14 9.75 16.708 9.928 16.9a.365.365 0 0 1-.327.543h-2.287c.029.612.029 1.223 0 1.831h2.297a2.206 2.206 0 0 0 1.922-3.31z',
]);

const Supabase = brandMark('0 0 24 24', [
  'M11.9 1.036c-.015-.986-1.26-1.41-1.874-.637L.764 12.05C-.33 13.427.65 15.455 2.409 15.455h9.579l.113 7.51c.014.985 1.259 1.408 1.873.636l9.262-11.653c1.093-1.375.113-3.403-1.645-3.403h-9.642z',
]);

const Context7 = brandMark('5 5 18 18', [
  'M10.5724 15.2565C10.5724 17.5025 9.6613 19.3778 8.17805 21.1047H11.6319L11.6319 22.7786H6.33459V21.1895C7.95557 19.3566 8.58065 17.8628 8.58065 15.2565L10.5724 15.2565Z',
  'M17.4276 15.2565C17.4276 17.5025 18.3387 19.3778 19.822 21.1047H16.3681V22.7786H21.6654V21.1895C20.0444 19.3566 19.4194 17.8628 19.4194 15.2565H17.4276Z',
  'M10.5724 12.7435C10.5724 10.4975 9.66131 8.62224 8.17807 6.89532L11.6319 6.89532V5.22137L6.33461 5.22137V6.81056C7.95558 8.64343 8.58066 10.1373 8.58066 12.7435L10.5724 12.7435Z',
  'M17.4276 12.7435C17.4276 10.4975 18.3387 8.62224 19.822 6.89532L16.3681 6.89532L16.3681 5.22138L21.6654 5.22138V6.81056C20.0444 8.64343 19.4194 10.1373 19.4194 12.7435H17.4276Z',
]);

const BRAND_ICONS: Record<string, BrandIcon> = {
  github: lobehubMark(LOBEHUB_MONO.github),
  cloudflare: lobehubMark(LOBEHUB_MONO.cloudflare),
  huggingface: lobehubMark(LOBEHUB_MONO.huggingface),
  notion: lobehubMark(LOBEHUB_MONO.notion),
  linear: Linear,
  sentry: Sentry,
  supabase: Supabase,
  context7: Context7,
};

const McpFallback = lobehubMark(LOBEHUB_MONO.mcp);

export function McpConnectorIcon({ catalogId }: { catalogId: string | null }) {
  const Icon = (catalogId !== null ? BRAND_ICONS[catalogId] : undefined) ?? McpFallback;
  return (
    <span
      aria-hidden
      className="flex size-5 flex-none items-center justify-center text-content-secondary"
    >
      <Icon size={18} />
    </span>
  );
}
