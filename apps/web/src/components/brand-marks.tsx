import type { SVGProps } from 'react';
import { LOBEHUB_MONO } from '../icons/lobehub-mono.js';

export function PiMark({ width = 16, height = 16, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      aria-hidden="true"
      width={width}
      height={height}
      viewBox="165.29 165.29 469.43 469.43"
      {...props}
    >
      <path fill="#F09082" d="M165.29 165.29H517.36V400H400V282.65H165.29Z" />
      <path fill="#4D9ABF" d="M165.29 282.65H282.65V400H400V517.36H282.65V634.72H165.29Z" />
      <path fill="#F1BE58" d="M517.36 400H634.72V634.72H517.36Z" />
    </svg>
  );
}

export function GeminiMark({ width = 16, height = 16, ...props }: SVGProps<SVGSVGElement>) {
  const mark = LOBEHUB_MONO.gemini;
  return (
    <svg aria-hidden="true" width={width} height={height} viewBox={mark.viewBox} {...props}>
      {mark.paths.map((d) => (
        <path key={d} fill="#3186FF" d={d} />
      ))}
    </svg>
  );
}

export function ClaudeMark({ width = 16, height = 16, ...props }: SVGProps<SVGSVGElement>) {
  const mark = LOBEHUB_MONO.claude;
  return (
    <svg aria-hidden="true" width={width} height={height} viewBox={mark.viewBox} {...props}>
      {mark.paths.map((d) => (
        <path key={d} fill="#D97757" d={d} />
      ))}
    </svg>
  );
}

export function ClaudeCodeMark({ width = 16, height = 16, ...props }: SVGProps<SVGSVGElement>) {
  const mark = LOBEHUB_MONO['claude-code'];
  return (
    <svg aria-hidden="true" width={width} height={height} viewBox={mark.viewBox} {...props}>
      {mark.paths.map((d) => (
        <path key={d} fill="#D97757" fillRule="evenodd" clipRule="evenodd" d={d} />
      ))}
    </svg>
  );
}

export function AnthropicMark({ width = 16, height = 16, ...props }: SVGProps<SVGSVGElement>) {
  const mark = LOBEHUB_MONO.anthropic;
  return (
    <svg
      aria-hidden="true"
      width={width}
      height={height}
      viewBox={mark.viewBox}
      fill="currentColor"
      fillRule="evenodd"
      {...props}
    >
      {mark.paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

export function OpenAIMark({ width = 16, height = 16, ...props }: SVGProps<SVGSVGElement>) {
  const mark = LOBEHUB_MONO.openai;
  return (
    <svg
      aria-hidden="true"
      width={width}
      height={height}
      viewBox={mark.viewBox}
      fillRule="evenodd"
      {...props}
    >
      {mark.paths.map((d) => (
        <path key={d} fill="currentColor" d={d} />
      ))}
    </svg>
  );
}

export function AntigravityMark({ width = 16, height = 16, ...props }: SVGProps<SVGSVGElement>) {
  const mark = LOBEHUB_MONO.antigravity;
  return (
    <svg
      aria-hidden="true"
      width={width}
      height={height}
      viewBox={mark.viewBox}
      fill="currentColor"
      {...props}
    >
      {mark.paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

export function DoubaoMark({ width = 16, height = 16, ...props }: SVGProps<SVGSVGElement>) {
  const mark = LOBEHUB_MONO.doubao;
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
      {mark.paths.map((d, index) => (
        <path key={d} d={d} fillOpacity={index === 1 ? 1 : 0.5} />
      ))}
    </svg>
  );
}

export function DevinMark({ width = 16, height = 16, ...props }: SVGProps<SVGSVGElement>) {
  const mark = LOBEHUB_MONO.devin;
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
}

export function GrokMark({ width = 16, height = 16, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg aria-hidden="true" width={width} height={height} viewBox="0 0 24 24" {...props}>
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M9.27 15.29l7.978-5.897c.391-.29.95-.177 1.137.272.98 2.369.542 5.215-1.41 7.169-1.951 1.954-4.667 2.382-7.149 1.406l-2.711 1.257c3.889 2.661 8.611 2.003 11.562-.953 2.341-2.344 3.066-5.539 2.388-8.42l.006.007c-.983-4.232.242-5.924 2.75-9.383.06-.082.12-.164.179-.248l-3.301 3.305v-.01L9.267 15.292M7.623 16.723c-2.792-2.67-2.31-6.801.071-9.184 1.761-1.763 4.647-2.483 7.166-1.425l2.705-1.25a7.808 7.808 0 00-1.829-1A8.975 8.975 0 005.984 5.83c-2.533 2.536-3.33 6.436-1.962 9.764 1.022 2.487-.653 4.246-2.34 6.022-.599.63-1.199 1.259-1.682 1.925l7.62-6.815"
      />
    </svg>
  );
}
