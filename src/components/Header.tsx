import React from 'react';
import { Database, Film, Zap, RefreshCw } from 'lucide-react';

interface HeaderProps {
  activeTab: 'portal' | 'sync';
  setActiveTab: (tab: 'portal' | 'sync') => void;
  isRunning: boolean;
  isPaused: boolean;
  pendingCount: number;
  onRefresh: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  setActiveTab,
  isRunning,
  isPaused,
  pendingCount,
  onRefresh,
}) => {
  return (
    <header className="sticky top-0 z-40 bg-slate-950/90 backdrop-blur-md border-b border-slate-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-8">
        {/* Zone 1: Brand Wordmark */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-amber-500 to-rose-600 flex items-center justify-center text-slate-950 font-black shadow-lg shadow-amber-500/10">
            <Film className="w-5 h-5 text-slate-950" />
          </div>
          <a href="#" className="text-xl font-bold tracking-tight text-white whitespace-nowrap shrink-0">
            Pine<span className="text-amber-400">Drama</span> <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 ml-1">Dracin Sync</span>
          </a>
        </div>

        {/* Zone 2: Navigation Tabs */}
        <nav className="flex items-center gap-2 bg-slate-900/80 p-1 rounded-xl border border-slate-800">
          <button
            onClick={() => setActiveTab('portal')}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-all whitespace-nowrap shrink-0 ${
              activeTab === 'portal'
                ? 'bg-amber-500 text-slate-950 font-semibold shadow-md'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
            }`}
          >
            <Film className="w-4 h-4" />
            <span>Streaming Portal</span>
          </button>

          <button
            onClick={() => setActiveTab('sync')}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-all whitespace-nowrap shrink-0 ${
              activeTab === 'sync'
                ? 'bg-amber-500 text-slate-950 font-semibold shadow-md'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
            }`}
          >
            <Database className="w-4 h-4" />
            <span>Sync Control Center</span>
            {pendingCount > 0 && (
              <span className="ml-1 px-1.5 py-0.5 text-xs font-mono rounded bg-amber-950 text-amber-300 border border-amber-800/60">
                {pendingCount}
              </span>
            )}
          </button>
        </nav>

        {/* Zone 3: Engine Status Indicator & Refresh */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="hidden sm:flex items-center gap-2 text-xs font-medium px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800">
            <span
              className={`w-2 h-2 rounded-full ${
                isRunning ? 'bg-emerald-400 animate-pulse' : isPaused ? 'bg-amber-400' : 'bg-slate-500'
              }`}
            />
            <span className="text-slate-300">
              {isRunning ? 'Worker Syncing' : isPaused ? 'Worker Paused' : 'Engine Idle'}
            </span>
          </div>

          <button
            onClick={onRefresh}
            title="Refresh Data"
            className="p-2 text-slate-400 hover:text-white bg-slate-900 hover:bg-slate-800 rounded-lg border border-slate-800 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
  );
};
