import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

interface State {
  error: Error | null;
  stack: string;
}

/** Last line of defence: a render error shows this instead of a blank window. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null, stack: "" };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(_error: Error, info: ErrorInfo) {
    this.setState({ stack: info.componentStack ?? "" });
  }

  private details(): string {
    const { error, stack } = this.state;
    return [error?.name, error?.message, error?.stack, stack].filter(Boolean).join("\n");
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="flex min-h-full flex-col items-center justify-center gap-4 px-6 text-center">
        <h1 className="text-[var(--text)]">Something went wrong</h1>
        <p className="max-w-md text-[var(--muted)]">
          The configurator hit an unexpected error. Your keyboard is unaffected. Reload to start again.
        </p>
        <p className="readout max-w-md truncate text-[var(--dim)]">{this.state.error.message}</p>
        <div className="flex gap-2">
          <Button type="button" onClick={() => window.location.reload()}>
            Reload
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => void navigator.clipboard?.writeText(this.details()).catch(() => {})}
          >
            Copy details
          </Button>
        </div>
      </div>
    );
  }
}
