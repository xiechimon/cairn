import { useEffect, useState } from 'react';
import type { EngineRunStage } from '../board/engine-run.js';
import { Button } from '../components/ui/button.js';
import { useI18n } from '../i18n/provider.js';
import {
  ENGINE_SCRIPTS,
  type EngineAnswers,
  type EngineScript,
  enginePhase,
  engineRunAt,
  engineScriptSteps,
} from './engine-runs.js';
import type { DetailContent, TodoRecord } from './records.js';

const STEP_MS = 1400;

export function engineRunStage(script: EngineScript): EngineRunStage {
  const start = Math.min(script.start, script.steps.length);
  return function EngineRunPlayer({ children }) {
    const { t } = useI18n();
    const [shown, setShown] = useState(start);
    const [answers, setAnswers] = useState<EngineAnswers>({});
    const [takenOver, setTakenOver] = useState(false);
    const [playing, setPlaying] = useState(false);
    const run = engineRunAt(script, shown, answers, takenOver);
    const advancing = run.state === 'running';
    useEffect(() => {
      if (!playing || !advancing) return;
      const timer = window.setInterval(() => setShown((count) => count + 1), STEP_MS);
      return () => window.clearInterval(timer);
    }, [playing, advancing]);
    return children({
      run,
      phase: enginePhase(run.state),
      actions: {
        answer: (eventId, answer) => {
          setAnswers((current) => ({ ...current, [eventId]: answer }));
          setShown((count) => count + 1);
        },
        takeOver: () => setTakenOver(true),
        handBack: () => setTakenOver(false),
      },
      controls: (
        <div data-testid="engine-player" className="mt-5 flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={!advancing}
            onClick={() => setShown((count) => count + 1)}
          >
            {t('下一步')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={!advancing && !playing}
            aria-pressed={playing}
            onClick={() => setPlaying((value) => !value)}
          >
            {t(playing ? '暂停播放' : '自动播放')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setShown(1);
              setAnswers({});
              setTakenOver(false);
              setPlaying(false);
            }}
          >
            {t('重来')}
          </Button>
          <span className="ml-auto text-meta text-content-tertiary tabular-nums">
            {t('事件 {n} / {total}', {
              n: run.events.length,
              total: engineScriptSteps(script, answers).length,
            })}
          </span>
        </div>
      ),
    });
  };
}

const ENGINE_PROJECT_ASK = '下载的附件文件名是乱码，帮我修一下';

export const ENGINE_THREADS: Array<{
  id: string;
  title: string;
  phase: TodoRecord['phase'];
  detail: DetailContent;
}> = Object.entries(ENGINE_SCRIPTS).map(([state, script]) => ({
  id: `home-c-engine-${state}`,
  title: state === 'long' ? '所有下载入口的文件名乱码' : '修复下载附件的文件名乱码',
  phase: enginePhase(engineRunAt(script, script.start).state),
  detail: {
    transcript: [
      { kind: 'user', text: ENGINE_PROJECT_ASK },
      {
        kind: 'robot',
        paragraphs: [[{ text: `这要改代码并跑测试，我派给 ${script.engine} 来做。` }]],
      },
    ],
    engineRun: engineRunAt(script, script.start),
    engineStage: engineRunStage(script),
  },
}));
