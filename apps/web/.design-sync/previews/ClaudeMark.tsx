import { ClaudeMark, GeminiMark, PiMark } from '@cairn/web';

const row = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 } as const;

const Sizes = ({ Mark }: { Mark: typeof ClaudeMark }) => (
  <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16 }}>
    <Mark />
    <Mark width={24} height={24} />
    <Mark width={40} height={40} />
  </div>
);

const ProviderRow = () => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
    <span style={row}><ClaudeMark /> Claude Code</span>
    <span style={row}><GeminiMark /> Gemini CLI</span>
    <span style={row}><PiMark /> pi</span>
  </div>
);

export const Scale = () => <Sizes Mark={ClaudeMark} />;
export { ProviderRow };
