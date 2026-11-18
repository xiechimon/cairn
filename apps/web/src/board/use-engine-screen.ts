import type { EngineTakeoverLease } from '@cairn/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../api/client.js';
import {
  acquireEngineTakeover,
  engineScreenWsUrl,
  fetchEnginePtyLog,
  openEngineScreen,
  releaseEngineTakeover,
  renewEngineTakeover,
} from '../api/engine-screen.js';
import { EngineTerminal } from './engine-terminal.js';

export type EngineScreenStatus = 'off' | 'connecting' | 'live' | 'ended' | 'failed';
export type EngineScreenKind = 'view' | 'takeover';

const RENEW_EVERY_MS = 10 * 60_000;

export interface EngineScreen {
  status: EngineScreenStatus;
  kind: EngineScreenKind;
  text: string;
  version: number;
  held: boolean;
  takeOver(): void;
  handBack(): void;
  send(bytes: string): void;
}

export function useEngineScreen(
  teamId: string | undefined,
  stepId: string | null,
  live: boolean,
): EngineScreen {
  const [status, setStatus] = useState<EngineScreenStatus>('off');
  const [kind, setKind] = useState<EngineScreenKind>('view');
  const [held, setHeld] = useState(false);
  const [version, setVersion] = useState(0);
  const terminal = useRef(new EngineTerminal());
  const ws = useRef<WebSocket | null>(null);
  const lease = useRef<EngineTakeoverLease | null>(null);
  const fromSeq = useRef(0);
  const mounted = useRef(true);
  const generation = useRef(0);

  const tick = useCallback(() => setVersion((value) => value + 1), []);

  const closeWs = useCallback(() => {
    const socket = ws.current;
    ws.current = null;
    if (socket !== null) {
      try {
        socket.close();
      } catch {}
    }
  }, []);

  const hydrateLog = useCallback(async () => {
    if (teamId === undefined || stepId === null) return;
    const gen = generation.current;
    for (let attempt = 0; attempt < 2 && terminal.current.text() === ''; attempt += 1) {
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 2500));
      try {
        const log = await fetchEnginePtyLog(teamId, stepId);
        if (!mounted.current || generation.current !== gen) return;
        if (log === null) continue;
        if (terminal.current.text() === '') {
          terminal.current.feed(new TextDecoder().decode(log));
          tick();
        }
        return;
      } catch {}
    }
  }, [teamId, stepId, tick]);

  const connect = useCallback(
    async (want: EngineScreenKind) => {
      if (teamId === undefined || stepId === null) return;
      const gen = generation.current;
      setStatus('connecting');
      try {
        const opened = await openEngineScreen(teamId, stepId, {
          kind: want,
          ...(want === 'takeover' && lease.current !== null
            ? { leaseId: lease.current.leaseId }
            : {}),
          fromSeq: fromSeq.current,
        });
        if (!mounted.current || generation.current !== gen) return;
        const socket = new WebSocket(engineScreenWsUrl(opened.path), opened.wsProtocols);
        socket.binaryType = 'arraybuffer';
        ws.current = socket;
        const decoder = new TextDecoder();
        socket.onopen = () => {
          if (!mounted.current) return;
          setKind(want);
          setStatus('live');
          setHeld(want === 'takeover');
        };
        socket.onmessage = (event) => {
          if (!(event.data instanceof ArrayBuffer)) return;
          fromSeq.current += event.data.byteLength;
          terminal.current.feed(decoder.decode(event.data, { stream: true }));
          tick();
        };
        socket.onclose = () => {
          if (ws.current === socket) ws.current = null;
          if (!mounted.current || generation.current !== gen) return;
          if (want === 'takeover') {
            setHeld(false);
            lease.current = null;
          }
          setStatus('ended');
          void hydrateLog();
          if (want === 'takeover') void connect('view');
        };
        socket.onerror = () => {};
      } catch (error) {
        if (!mounted.current || generation.current !== gen) return;
        if (want === 'takeover') {
          lease.current = null;
          setHeld(false);
          void connect('view');
          return;
        }
        setStatus(error instanceof ApiError ? 'ended' : 'failed');
        if (error instanceof ApiError) void hydrateLog();
      }
    },
    [teamId, stepId, tick, hydrateLog],
  );

  useEffect(() => {
    mounted.current = true;
    if (!live || teamId === undefined || stepId === null) {
      setStatus('off');
      return;
    }
    terminal.current = new EngineTerminal();
    fromSeq.current = 0;
    generation.current += 1;
    void connect('view');
    return () => {
      mounted.current = false;
      generation.current += 1;
      closeWs();
      setHeld(false);
      setStatus('off');
    };
  }, [live, teamId, stepId, connect, closeWs]);

  useEffect(() => {
    if (!held || teamId === undefined || stepId === null) return;
    const renew = setInterval(() => {
      const current = lease.current;
      if (current === null || teamId === undefined || stepId === null) return;
      renewEngineTakeover(teamId, stepId, current.leaseId)
        .then((next) => {
          lease.current = next;
        })
        .catch(() => {
          lease.current = null;
          setHeld(false);
        });
    }, RENEW_EVERY_MS);
    return () => clearInterval(renew);
  }, [held, teamId, stepId]);

  const takeOver = useCallback(() => {
    if (teamId === undefined || stepId === null) return;
    acquireEngineTakeover(teamId, stepId)
      .then((next) => {
        lease.current = next;
        closeWs();
        void connect('takeover');
      })
      .catch(() => {
        lease.current = null;
        setHeld(false);
      });
  }, [teamId, stepId, connect, closeWs]);

  const handBack = useCallback(() => {
    const current = lease.current;
    lease.current = null;
    setHeld(false);
    if (teamId !== undefined && stepId !== null && current !== null) {
      void releaseEngineTakeover(teamId, stepId, current.leaseId).catch(() => {});
    }
    closeWs();
    void connect('view');
  }, [teamId, stepId, connect, closeWs]);

  useEffect(
    () => () => {
      const current = lease.current;
      lease.current = null;
      if (current !== null && teamId !== undefined && stepId !== null) {
        void releaseEngineTakeover(teamId, stepId, current.leaseId).catch(() => {});
      }
    },
    [teamId, stepId],
  );

  const send = useCallback(
    (bytes: string) => {
      if (kind !== 'takeover' || !held) return;
      ws.current?.send(bytes);
    },
    [kind, held],
  );

  return {
    status,
    kind,
    text: terminal.current.text(),
    version,
    held,
    takeOver,
    handBack,
    send,
  };
}
