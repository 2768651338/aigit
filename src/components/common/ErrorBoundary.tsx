import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** Optional custom fallback renderer. */
  fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Global error boundary — prevents a single component crash from
 * white-screening the whole app. Renders a friendly fallback with a
 * "reload" affordance and a collapsible error stack for debugging.
 *
 * Usage:
 *   <ErrorBoundary><App /></ErrorBoundary>
 *   <ErrorBoundary fallback={(e, reset) => <MyFallback />}>
 *     <RiskyView />
 *   </ErrorBoundary>
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error("[aigit] ErrorBoundary caught:", error, info);
  }

  reset = () => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback(this.state.error, this.reset);
      }
      return <DefaultFallback error={this.state.error} reset={this.reset} />;
    }
    return this.props.children;
  }
}

function DefaultFallback({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-8 py-10">
      <div className="w-12 h-12 rounded-full bg-danger/10 text-danger flex items-center justify-center mb-4 text-2xl">
        !
      </div>
      <h2 className="text-base font-semibold text-text-primary mb-1">
        Something went wrong
      </h2>
      <p className="text-sm text-text-secondary mb-4 max-w-md break-words">
        {error.message || "Unexpected error"}
      </p>
      <details className="mb-4 max-w-2xl w-full">
        <summary className="text-xs text-text-muted cursor-pointer hover:text-text-secondary">
          Stack trace
        </summary>
        <pre className="mt-2 p-3 bg-bg-surface border border-border rounded text-xs text-text-muted overflow-auto text-left whitespace-pre-wrap break-all">
          {error.stack ?? String(error)}
        </pre>
      </details>
      <div className="flex gap-2">
        <button onClick={reset} className="btn-secondary">
          Retry
        </button>
        <button
          onClick={() => window.location.reload()}
          className="btn-primary"
        >
          Reload
        </button>
      </div>
    </div>
  );
}
