import type { StepKind } from '@cairn/shared';

export interface RelayToolInvocation<TCtx> {
  readonly name: string;
  readonly args: Record<string, unknown>;
  readonly stepKind: StepKind;
  readonly context: TCtx;
}

export interface RelayToolNamespace<TCtx> {
  readonly id: string;
  matches(name: string, stepKind: StepKind): boolean;
  execute(call: RelayToolInvocation<TCtx>): Promise<string>;
}

export interface RelayToolRegistry<TCtx> {
  resolve(name: string, stepKind: StepKind): RelayToolNamespace<TCtx> | undefined;
  dispatch(call: RelayToolInvocation<TCtx>): Promise<string>;
  list(): readonly string[];
}

export function createRelayToolRegistry<TCtx>(
  namespaces: readonly RelayToolNamespace<TCtx>[],
): RelayToolRegistry<TCtx> {
  const registered = [...namespaces];
  const resolve = (name: string, stepKind: StepKind): RelayToolNamespace<TCtx> | undefined =>
    registered.find((namespace) => namespace.matches(name, stepKind));
  return {
    resolve,
    dispatch(call) {
      const namespace = resolve(call.name, call.stepKind);
      if (namespace === undefined) {
        return Promise.reject(
          new Error(`no relay tool namespace registered for ${call.stepKind}:${call.name}`),
        );
      }
      return namespace.execute(call);
    },
    list() {
      return registered.map((namespace) => namespace.id);
    },
  };
}
