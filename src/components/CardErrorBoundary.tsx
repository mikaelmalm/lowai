import { Component, type ReactNode } from "react";

export class CardErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  render() {
    if (this.state.failed) return <p className="system-card">This card could not be shown.</p>;
    return this.props.children;
  }
}
