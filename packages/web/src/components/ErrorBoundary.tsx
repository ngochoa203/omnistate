import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: any) {
    console.error("[ErrorBoundary]", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div style={{
          display: "flex", flexDirection: "column", alignItems: "center",
          justifyContent: "center", padding: 40, color: "#5a5a7a",
          minHeight: 200,
        }}>
          <div style={{
            width: 48, height: 48, borderRadius: 12,
            background: "rgba(239,68,68,0.1)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 20, marginBottom: 16,
          }}>
            ⚠
          </div>
          <p style={{ fontSize: 14, fontWeight: 600, color: "#ef4444", marginBottom: 8 }}>
            Something went wrong
          </p>
          <p style={{ fontSize: 12, color: "#5a5a7a", marginBottom: 16, textAlign: "center", maxWidth: 300 }}>
            {this.state.error?.message || "An unexpected error occurred"}
          </p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{
              padding: "8px 20px", borderRadius: 8, fontSize: 13,
              background: "rgba(99,102,241,0.15)", border: "1px solid rgba(99,102,241,0.3)",
              color: "#6366f1", cursor: "pointer", fontWeight: 500,
            }}
          >
            Try Again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
