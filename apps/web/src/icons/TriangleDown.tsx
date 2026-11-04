import type { SVGProps } from 'react';

export function TriangleDown({ width = 10, height = 10, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      aria-hidden="true"
      width={width}
      height={height}
      viewBox="0 0 12 12"
      fill="currentColor"
      {...props}
    >
      <path d="M3.5 4.5h5L6 8Z" />
    </svg>
  );
}
