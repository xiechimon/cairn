import { MessageSquareWarning, WifiOff } from 'lucide-react';
import {
  Component,
  type ComponentType,
  createElement,
  Fragment,
  lazy,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
} from 'react';
import { useConnectionOutage } from '../api/connection-state.js';
import { useI18n } from '../i18n/provider.js';
import { EmptyState } from './empty-state.js';

/** Wraps React.lazy so a rejected dynamic import resets and retries on remount. */
// biome-ignore lint/suspicious/noExplicitAny: React.lazy requires ComponentType<any> as its generic constraint
export function retryableLazy<T extends ComponentType<any>>(
  load: () => Promise<{ default: T }>,
): T {
  const loadFresh = (): Promise<{ default: T }> =>
    load().catch((error: unknown) => {
      LazyComponent = lazy(loadFresh);
      throw error;
    });
  let LazyComponent = lazy(loadFresh);
  return ((props: Record<string, never>) =>
    createElement(
      LazyComponent as unknown as ComponentType<Record<string, never>>,
      props,
    )) as unknown as T;
}

interface BoundaryProps {
  children: ReactNode;
  resetKey?: string;
  frame?: (fallback: ReactNode) => ReactNode;
}

interface BoundaryState {
  failed: boolean;
  networkError: boolean;
  resetKey: number;
  contextKey?: string;
}

const NETWORK_LOAD_ERROR =
  /Failed to fetch|dynamically imported module|Importing a module script failed|Load failed/i;

function isNetworkLoadError(error: unknown): boolean {
  return error instanceof Error && NETWORK_LOAD_ERROR.test(error.message);
}

function BoundaryFallback({
  onRetry,
  networkError,
}: {
  onRetry: () => void;
  networkError: boolean;
}) {
  const { t } = useI18n();
  const { connected, retryNow } = useConnectionOutage();
  const sawOfflineRef = useRef(!connected);

  useEffect(() => {
    if (networkError && connected) {
      retryNow();
    }
  }, [networkError, connected, retryNow]);

  useLayoutEffect(() => {
    if (!connected) {
      sawOfflineRef.current = true;
      return;
    }
    if (sawOfflineRef.current) {
      sawOfflineRef.current = false;
      onRetry();
    }
  }, [connected, onRetry]);

  if (!connected || networkError) {
    return (
      <EmptyState
        testId="error-boundary"
        icon={WifiOff}
        title={t('当前无法连接服务器')}
        description={t('恢复连接后自动重试。')}
        action={{
          label: t('立即重试'),
          onClick: () => {
            retryNow();
            onRetry();
          },
        }}
        className="h-full min-h-40"
      />
    );
  }

  return (
    <EmptyState
      testId="error-boundary"
      icon={MessageSquareWarning}
      title={t('这一块出错了')}
      description={t('页面其余部分还在，重试会重新打开这一块。')}
      action={{ label: t('重试'), onClick: onRetry }}
      className="h-full min-h-40"
    />
  );
}

export class SubtreeErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { failed: false, networkError: false, resetKey: 0 };

  static getDerivedStateFromError(error: unknown): Pick<BoundaryState, 'failed' | 'networkError'> {
    return { failed: true, networkError: isNetworkLoadError(error) };
  }

  static getDerivedStateFromProps(
    props: BoundaryProps,
    state: BoundaryState,
  ): Partial<BoundaryState> | null {
    if (props.resetKey === state.contextKey) return null;
    return {
      contextKey: props.resetKey,
      ...(state.failed ? { failed: false, networkError: false, resetKey: state.resetKey + 1 } : {}),
    };
  }

  private retry = (): void => {
    this.setState((state) => ({
      failed: false,
      networkError: false,
      resetKey: state.resetKey + 1,
    }));
  };

  render() {
    if (!this.state.failed)
      return <Fragment key={this.state.resetKey}>{this.props.children}</Fragment>;
    const fallback = (
      <BoundaryFallback onRetry={this.retry} networkError={this.state.networkError} />
    );
    return this.props.frame?.(fallback) ?? fallback;
  }
}
