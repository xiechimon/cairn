import type { SVGProps } from 'react';

export function TriangleRight({ width = 10, height = 10, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      aria-hidden="true"
      width={width}
      height={height}
      viewBox="0 0 12 12"
      fill="currentColor"
      {...props}
    >
      <path d="M4.5 3.5v5L8 6Z" />
    </svg>
  );
}
