import type { SVGProps } from 'react';

export function BarChart3({ width = 15, height = 15, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      aria-hidden="true"
      width={width}
      height={height}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M6 20v-8" />
      <path d="M12 20V4" />
      <path d="M18 20v-5" />
    </svg>
  );
}
