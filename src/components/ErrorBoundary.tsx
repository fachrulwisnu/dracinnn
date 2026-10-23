import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertOctagon, RefreshCw, Terminal as TerminalIcon } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error caught by ErrorBoundary:', error, errorInfo);
    this.setState({ errorInfo });

    // Send to global TerminalLogger if available
    try {
      if (typeof window !== 'undefined' && (window as any).__terminalLogger?.addLog) {
        (window as any).__terminalLogger.addLog(
          'error',
          `[React Crash Boundary] ${error.message || 'Fatal Runtime Component Crash'}`,
          errorInfo.componentStack || error.stack
        );
      }
    } catch (e) {
      console.warn('Failed to dispatch crash log to terminal:', e);
    }
  }

  private handleReload = () => {
    window.location.reload();
  };

  private handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="min-h-screen bg-[#070a10] text-slate-100 flex items-center justify-center p-4">
          <div className="max-w-xl w-full bg-slate-900/90 border border-rose-500/40 rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6">
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-2xl bg-rose-500/20 text-rose-400 border border-rose-500/30">
                <AlertOctagon className="w-8 h-8" />
              </div>
              <div>
                <h1 className="text-xl font-black text-white">Komponen Mengalami Error</h1>
                <p className="text-xs text-rose-300 font-mono">React Error Boundary telah mencegah layar blank (blank screen).</p>
              </div>
            </div>

            <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 space-y-2">
              <div className="text-xs font-bold uppercase tracking-wider text-slate-400">Pesan Kesalahan:</div>
              <div className="text-sm font-mono text-rose-300 font-semibold break-words">
                {this.state.error?.message || 'Unknown runtime error occurred'}
              </div>
              {this.state.errorInfo?.componentStack && (
                <details className="pt-2 border-t border-slate-800/80">
                  <summary className="text-[11px] font-mono text-slate-500 hover:text-slate-300 cursor-pointer select-none">
                    Lihat Component Stack Trace
                  </summary>
                  <pre className="text-[10px] font-mono text-slate-400 mt-2 p-2 bg-slate-900 rounded-lg overflow-x-auto whitespace-pre-wrap max-h-48">
                    {this.state.errorInfo.componentStack}
                  </pre>
                </details>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={this.handleReset}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs transition-all cursor-pointer shadow-lg shadow-cyan-500/20"
              >
                <RefreshCw className="w-4 h-4" />
                <span>Coba Render Ulang Komponen</span>
              </button>

              <button
                onClick={this.handleReload}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs border border-slate-700 transition-all cursor-pointer"
              >
                <span>Muat Ulang Halaman</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
