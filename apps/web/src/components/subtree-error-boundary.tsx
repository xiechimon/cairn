import { MessageSquareWarning } from 'lucide-react';
import { Component, Fragment, type ReactNode } from 'react';
import { useI18n } from '../i18n/provider.js';
import { EmptyState } from './empty-state.js';

interface BoundaryProps {
  children: ReactNode;
  resetKey?: string;
}

interface BoundaryState {
  failed: boolean;
  resetKey: number;
  contextKey?: string;
}

function BoundaryFallback({ onRetry }: { onRetry: () => void }) {
  const { t } = useI18n();
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
  state: BoundaryState = { failed: false, resetKey: 0 };

  static getDerivedStateFromError(): Pick<BoundaryState, 'failed'> {
    return { failed: true };
  }

  static getDerivedStateFromProps(
    props: BoundaryProps,
    state: BoundaryState,
  ): Partial<BoundaryState> | null {
    if (props.resetKey === state.contextKey) return null;
    return {
      contextKey: props.resetKey,
      ...(state.failed ? { failed: false, resetKey: state.resetKey + 1 } : {}),
    };
  }

  private retry = (): void => {
    this.setState((state) => ({ failed: false, resetKey: state.resetKey + 1 }));
  };

  render() {
    if (this.state.failed) return <BoundaryFallback onRetry={this.retry} />;
    return <Fragment key={this.state.resetKey}>{this.props.children}</Fragment>;
  }
}
