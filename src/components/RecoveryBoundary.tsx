import { Component, Fragment, type ErrorInfo, type ReactNode } from 'react';

export class RecoveryBoundary extends Component<
  { children: ReactNode },
  { failed: boolean; attempt: number }
> {
  state = { failed: false, attempt: 0 };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error, _info: ErrorInfo) {
    console.error('ASQAC view recovery:', error.name, error.message);
  }
  render() {
    if (this.state.failed)
      return (
        <section className="recovery-view" role="alert">
          <span className="eyebrow">ASQAC · CONNECTION RECOVERY</span>
          <h1>Let’s restore this view</h1>
          <p>This page could not finish loading. Retry the view, or reload the workspace.</p>
          <div className="button-row">
            <button
              className="button primary"
              onClick={() =>
                this.setState((state) => ({ failed: false, attempt: state.attempt + 1 }))
              }
            >
              Retry view
            </button>
            <button className="button secondary" onClick={() => window.location.reload()}>
              Reload workspace
            </button>
          </div>
        </section>
      );
    return <Fragment key={this.state.attempt}>{this.props.children}</Fragment>;
  }
}
