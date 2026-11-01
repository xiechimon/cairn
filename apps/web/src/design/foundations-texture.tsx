import { useState } from 'react';
import { EmptyState } from '../components/empty-state.js';
import { SegmentedRadio } from '../components/segmented.js';
import {
  DriftEdge,
  DriftField,
  SpiralArt,
  SpiralMark,
  TexturedTile,
  TextureSkeleton,
} from '../components/texture/texture.js';
import type { TextureFilter } from '../components/texture/texture-core.js';
import { Switch } from '../components/ui/switch.js';
import { MessageSquare } from '../icons/index.js';
import { Labeled, Section, Specimen } from './specimen.js';

const FILTERS: { value: TextureFilter; label: string }[] = [
  { value: 'ascii', label: 'ASCII' },
  { value: 'dither', label: 'Dither' },
];

function FilterSwitch({
  value,
  onChange,
}: {
  value: TextureFilter;
  onChange: (next: TextureFilter) => void;
}) {
  return (
    <SegmentedRadio
      label="Filter"
      value={value}
      onChange={onChange}
      options={FILTERS}
      className="w-44"
    />
  );
}

export function TextureSection() {
  const [artFilter, setArtFilter] = useState<TextureFilter>('ascii');
  const [markFilter, setMarkFilter] = useState<TextureFilter>('dither');
  const [fieldFilter, setFieldFilter] = useState<TextureFilter>('dither');
  const [running, setRunning] = useState(true);
  return (
    <Section
      id="texture"
      title="Texture"
      lede="The Cairn spiral and a slow noise field, drawn as ASCII characters or 4×4 Bayer dots in the project hue. Texture marks arrival, emptiness and agents at work; surfaces you read stay flat. Motion runs only while something runs and stops under reduced motion."
    >
      <Specimen
        title="Spiral art"
        note="Sign-in and first run: the logo spiral, enlarged and cropped, under a veil that clears for the headline"
        code={`<SpiralArt filter="ascii" className="h-96">\n  <Headline />\n</SpiralArt>`}
      >
        <div className="flex w-full flex-col gap-3">
          <FilterSwitch value={artFilter} onChange={setArtFilter} />
          <SpiralArt filter={artFilter} className="h-96 w-full max-w-120">
            <div className="flex h-96 flex-col justify-end p-6">
              <p className="m-0 font-serif text-greeting text-project-ink-1">
                Agents that bring back
                <br />
                <i>only what needs you.</i>
              </p>
            </div>
          </SpiralArt>
        </div>
      </Specimen>
      <Specimen
        title="Spiral mark"
        note="Large empty states swap the line icon for the spiral in dots"
        code={`<EmptyState media={<SpiralMark />} title="No threads yet" … />`}
      >
        <div className="flex w-full flex-col gap-3">
          <FilterSwitch value={markFilter} onChange={setMarkFilter} />
          <EmptyState
            icon={MessageSquare}
            media={<SpiralMark filter={markFilter} />}
            title="No threads yet"
            description="Ask the Coordinator for something and it starts one."
            action={{ label: 'Ask the Coordinator' }}
          />
        </div>
      </Specimen>
      <Specimen
        title="Drift field"
        note="Behind the Coordinator greeting and on a running card; it freezes to one frame when nothing runs"
        code={`<DriftField active={running} />\n<DriftEdge active={card.running} />`}
      >
        <div className="flex w-full flex-col gap-3">
          <div className="flex items-center gap-4">
            <FilterSwitch value={fieldFilter} onChange={setFieldFilter} />
            <span className="flex items-center gap-2 text-ui text-content-secondary">
              <Switch checked={running} onCheckedChange={setRunning} aria-label="Agents running" />
              Agents running
            </span>
          </div>
          <div className="overflow-hidden rounded-(--radius-card) bg-background ring-1 ring-border">
            <div className="relative h-48">
              <DriftField active={running} filter={fieldFilter} />
              <div className="absolute bottom-6 left-8">
                <p className="m-0 font-serif text-page font-semibold text-foreground">
                  Morning, ian.
                </p>
                <p className="m-0 mt-1 text-ui text-content-secondary">
                  2 threads running, 3 merged since last night, 1 needs you
                </p>
              </div>
            </div>
            <div className="px-8 pb-6">
              <div className="relative overflow-hidden rounded-(--radius-card) bg-card px-4 py-3 ring-1 ring-border">
                <DriftEdge active={running} filter={fieldFilter} />
                <p className="relative m-0 text-ui font-semibold text-foreground">
                  Push for finished and failed threads
                </p>
                <p className="relative m-0 text-meta text-content-tertiary">
                  Writing the device receipt test · step 3 of 5
                </p>
              </div>
            </div>
          </div>
        </div>
      </Specimen>
      <Specimen
        title="Textured tiles and loading"
        note="Project tiles at 40px and up, and a dot sweep for loading; smaller tiles stay flat"
        code={`<TexturedTile letter="C" tone={1} />\n<TextureSkeleton />`}
      >
        <div className="flex w-full flex-col gap-5">
          <Labeled label="TexturedTile, tones 1–6">
            <div className="flex gap-3">
              {(['C', 'S', 'W', 'D', 'A', 'M'] as const).map((letter, i) => (
                <TexturedTile
                  key={letter}
                  letter={letter}
                  tone={(i + 1) as 1 | 2 | 3 | 4 | 5 | 6}
                />
              ))}
            </div>
          </Labeled>
          <Labeled label="TextureSkeleton">
            <TextureSkeleton />
          </Labeled>
        </div>
      </Specimen>
    </Section>
  );
}
