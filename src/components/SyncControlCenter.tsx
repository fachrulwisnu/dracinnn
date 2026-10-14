import React, { useState, useEffect, useRef } from 'react';
import {
  Play,
  Pause,
  Terminal,
  Database,
  Layers,
  CheckCircle2,
  Clock,
  Zap,
  Trash2,
  Film,
  AlertTriangle,
  Globe,
  Server,
  ShieldCheck,
  Compass,
  Sparkles,
  ArrowUpDown,
  Plus,
} from 'lucide-react';
import { EndpointInspector } from './EndpointInspector';
import { CatalogExplorerStaging } from './CatalogExplorerStaging';
import { NewlyAddedHistory } from './NewlyAddedHistory';

interface DramaItem {
  dramaId: string;
  title: string;
  coverUrl: string;
  categories: string[];
  totalEpisodes: number;
  syncedEpisodesCount: number;
  pendingEpisodesCount: number;
  syncStatus: string;
  isNewlyAdded?: boolean;
  importedAt?: string;
  updatedAt: string;
}

interface WorkerState {
  isRunning: boolean;
  isPaused: boolean;
  currentTask: string;
  requestsMadeInCurrentMinute: number;
  currentDramaId?: string | null;
  currentEpisodeNumber?: number | null;
  priorityDramaId?: string | null;
  logs: string[];
  cooldownUntil?: string | null;
}

interface Counters {
  totalCategories: number;
  totalDramas: number;
  syncedEpisodes: number;
  pendingEpisodes: number;
}

interface SyncControlCenterProps {
  workerState: WorkerState;
  counters: Counters;
  dramas: DramaItem[];
  categories: any[];
  onTriggerCategories: () => void;
  onResumeWorker: () => void;
  onPauseWorker: () => void;
  onPrioritizeDrama: (dramaId: string) => void;
  onSelectDrama: (dramaId: string) => void;
  onClearLogs: () => void;
  onSortChange: (sortKey: string) => void;
  onRefreshAllData: () => void;
  loadingAction: string | null;
}

export const SyncControlCenter: React.FC<SyncControlCenterProps> = ({
  workerState,
  counters,
  dramas,
  categories,
  onTriggerCategories,
  onResumeWorker,
  onPauseWorker,
  onPrioritizeDrama,
  onSelectDrama,
  onClearLogs,
  onSortChange,
  onRefreshAllData,
  loadingAction,
}) => {
  const [logFilter, setLogFilter] = useState<string>('');
  const [activeSubTab, setActiveSubTab] = useState<'explorer' | 'history' | 'inspector'>('explorer');
  const [sortOption, setSortOption] = useState<string>('importedAt_desc');

  // Speed Selector: 'SAFE' (5 req/min, 12.5s) vs 'FAST' (10 req/min, 6.5s)
  const [rateLimitSpeed, setRateLimitSpeed] = useState<'SAFE' | 'FAST'>('SAFE');

  // Browser Sync State
  const [isBrowserSyncActive, setIsBrowserSyncActive] = useState<boolean>(false);
  const [browserTask, setBrowserTask] = useState<string>('IDLE');
  const [browserCountdown, setBrowserCountdown] = useState<number>(0);
  const [cooldownCountdown, setCooldownCountdown] = useState<number>(0);
  const [browserLogs, setBrowserLogs] = useState<string[]>([]);

  const browserWorkerActiveRef = useRef<boolean>(false);

  const delayIntervalMs = rateLimitSpeed === 'SAFE' ? 12500 : 6500;

  const addBrowserLog = (msg: string) => {
    const time = new Date().toISOString().slice(11, 19);
    setBrowserLogs((prev) => [`[${time}] ${msg}`, ...prev.slice(0, 80)]);
  };

  const allLogs = [...browserLogs, ...workerState.logs];
  const filteredLogs = allLogs.filter((log) =>
    logFilter ? log.toLowerCase().includes(logFilter.toLowerCase()) : true
  );

  // Browser-Assisted Episode Sync Loop
  const runBrowserEpisodeSync = async () => {
    if (browserWorkerActiveRef.current) return;
    browserWorkerActiveRef.current = true;
    setIsBrowserSyncActive(true);
    setBrowserTask('SYNCING_EPISODES');

    addBrowserLog(`=== STAGE 3: Browser Episode Sync Loop Started (${rateLimitSpeed} Mode: ${delayIntervalMs / 1000}s slot) ===`);

    try {
      while (browserWorkerActiveRef.current) {
        const pendingRes = await fetch('/api/sync/next-pending-episodes?limit=1');
        const pendingData = await pendingRes.json();

        if (!pendingData.success || !pendingData.pendingEpisodes || pendingData.pendingEpisodes.length === 0) {
          addBrowserLog('✔ All pending episodes across database synced successfully! Worker resting.');
          break;
        }

        const nextEp = pendingData.pendingEpisodes[0];
        const targetCollectionId = nextEp.collection_id || nextEp.dramaId;
        const epNum = nextEp.episodeNumber;

        addBrowserLog(`Browser Syncing: ${nextEp.title || targetCollectionId} - Episode ${epNum}...`);

        const fetchUrl = `https://api.sansekai.my.id/api/pinedrama/get-episode?collection_id=${targetCollectionId}&episodeNumber=${epNum}&lang=id`;

        try {
          const res = await fetch(fetchUrl, {
            method: 'GET',
            headers: { Accept: '*/*' },
            referrerPolicy: 'no-referrer',
            credentials: 'omit',
          });

          if (res.status === 429) {
            addBrowserLog('⚠ [HTTP 429 Too Many Requests] Triggering 60s cooldown countdown...');
            await trigger429Cooldown();
            continue;
          }

          if (res.ok) {
            const jsonPayload = await res.json();
            await fetch('/api/sync/save-episode', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                collection_id: targetCollectionId,
                episodeNumber: epNum,
                rawResponse: jsonPayload,
              }),
            });
            onRefreshAllData();
          } else {
            addBrowserLog(`✖ HTTP ${res.status} fetching Ep ${epNum} for ${targetCollectionId}`);
            await fetch('/api/sync/save-episode', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                collection_id: targetCollectionId,
                episodeNumber: epNum,
                syncStatus: 'FAILED',
                errorMessage: `HTTP ${res.status} from API`,
              }),
            });
          }
        } catch (fetchErr: any) {
          addBrowserLog(`✖ Error fetching Ep ${epNum}: ${fetchErr.message}`);
          await fetch('/api/sync/save-episode', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              collection_id: targetCollectionId,
              episodeNumber: epNum,
              syncStatus: 'FAILED',
              errorMessage: fetchErr.message,
            }),
          });
        }

        await runIntervalCountdown(delayIntervalMs / 1000);
      }
    } catch (err: any) {
      addBrowserLog(`Error in browser episode sync loop: ${err.message}`);
    } finally {
      browserWorkerActiveRef.current = false;
      setIsBrowserSyncActive(false);
      setBrowserTask('IDLE');
    }
  };

  const stopBrowserSync = () => {
    browserWorkerActiveRef.current = false;
    setIsBrowserSyncActive(false);
    setBrowserTask('PAUSED');
    addBrowserLog('Browser Worker paused by user.');
  };

  const trigger429Cooldown = async () => {
    for (let sec = 60; sec > 0; sec--) {
      if (!browserWorkerActiveRef.current) break;
      setCooldownCountdown(sec);
      await new Promise((r) => setTimeout(r, 1000));
    }
    setCooldownCountdown(0);
    addBrowserLog('✔ Cooldown finished! Resuming episode sync automatically...');
  };

  const runIntervalCountdown = async (seconds: number) => {
    for (let sec = Math.ceil(seconds); sec > 0; sec--) {
      if (!browserWorkerActiveRef.current) break;
      setBrowserCountdown(sec);
      await new Promise((r) => setTimeout(r, 1000));
    }
    setBrowserCountdown(0);
  };

  const handleSortChangeInternal = (key: string) => {
    setSortOption(key);
    onSortChange(key);
  };

  return (
    <div className="space-[#121826] min-h-screen text-slate-100 p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-8">
      {/* 1. Control Action Bar */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800/80 pb-4">
          <div>
            <h1 className="text-2xl font-black text-white flex items-center gap-3">
              <Zap className="w-6 h-6 text-amber-400" />
              Automated Sync &amp; Rate Limiter Control Center
            </h1>
            <p className="text-sm text-slate-400 mt-1">
              100% Client-Browser-Driven Scraper bypassing backend Cloudflare 403 blocks. Direct to MongoDB Atlas.
            </p>
          </div>

          {/* Speed Selector */}
          <div className="bg-slate-950 p-1.5 rounded-xl border border-slate-800 flex items-center gap-2">
            <span className="text-xs text-slate-400 font-semibold px-2">Speed Mode:</span>
            <button
              onClick={() => setRateLimitSpeed('SAFE')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                rateLimitSpeed === 'SAFE'
                  ? 'bg-emerald-500 text-slate-950 shadow-md'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Safe Mode (5 req/min · 12.5s)</span>
            </button>

            <button
              onClick={() => setRateLimitSpeed('FAST')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                rateLimitSpeed === 'FAST'
                  ? 'bg-amber-500 text-slate-950 shadow-md'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Zap className="w-3.5 h-3.5" />
              <span>Fast Mode (10 req/min · 6.5s)</span>
            </button>
          </div>
        </div>

        {/* Sync Controls */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <button
            onClick={runBrowserEpisodeSync}
            disabled={isBrowserSyncActive}
            className="flex items-center justify-center gap-3 px-5 py-3.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white font-bold text-sm hover:from-emerald-500 hover:to-teal-500 transition-all shadow-lg shadow-emerald-600/10 disabled:opacity-50 cursor-pointer"
          >
            <Play className="w-5 h-5 fill-current" />
            <span>Start Episode Sync ({rateLimitSpeed} Mode)</span>
          </button>

          <button
            onClick={stopBrowserSync}
            disabled={!isBrowserSyncActive}
            className="flex items-center justify-center gap-3 px-5 py-3.5 rounded-xl bg-slate-800 border border-slate-700 text-slate-200 font-bold text-sm hover:bg-slate-700 hover:text-white transition-all disabled:opacity-50 cursor-pointer"
          >
            <Pause className="w-5 h-5 fill-current" />
            <span>Pause Sync Engine</span>
          </button>
        </div>
      </div>

      {/* 2. Rate Limit Telemetry & Live Stats */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-lg flex items-center gap-4">
          <div className="p-3 bg-amber-500/10 rounded-xl text-amber-400 border border-amber-500/20">
            <Layers className="w-6 h-6" />
          </div>
          <div>
            <div className="text-2xl font-black text-white font-mono">{counters.totalCategories}</div>
            <div className="text-xs text-slate-400 font-medium uppercase tracking-wider">Total Categories</div>
          </div>
        </div>

        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-lg flex items-center gap-4">
          <div className="p-3 bg-blue-500/10 rounded-xl text-blue-400 border border-blue-500/20">
            <Film className="w-6 h-6" />
          </div>
          <div>
            <div className="text-2xl font-black text-white font-mono">{counters.totalDramas}</div>
            <div className="text-xs text-slate-400 font-medium uppercase tracking-wider">Total Dramas</div>
          </div>
        </div>

        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-lg flex items-center gap-4">
          <div className="p-3 bg-emerald-500/10 rounded-xl text-emerald-400 border border-emerald-500/20">
            <CheckCircle2 className="w-6 h-6" />
          </div>
          <div>
            <div className="text-2xl font-black text-white font-mono">{counters.syncedEpisodes}</div>
            <div className="text-xs text-slate-400 font-medium uppercase tracking-wider">Episodes Synced</div>
          </div>
        </div>

        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-lg flex items-center gap-4">
          <div className="p-3 bg-rose-500/10 rounded-xl text-rose-400 border border-rose-500/20">
            <Clock className="w-6 h-6" />
          </div>
          <div>
            <div className="text-2xl font-black text-white font-mono">{counters.pendingEpisodes}</div>
            <div className="text-xs text-slate-400 font-medium uppercase tracking-wider">Episodes Pending</div>
          </div>
        </div>
      </div>

      {/* Rate Limiter Telemetry Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-900 to-amber-950/40 border border-amber-500/20 rounded-2xl p-5 flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="p-3 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/30">
            <Zap className="w-6 h-6" />
          </div>
          <div>
            <div className="text-sm font-bold text-amber-200">Browser Direct Fetch Telemetry</div>
            <div className="text-xs text-slate-400 mt-0.5">
              Active Speed Mode: <span className="font-mono text-amber-300 font-bold">{rateLimitSpeed} ({delayIntervalMs / 1000}s per slot)</span>
              {browserCountdown > 0 && (
                <span className="ml-2 text-emerald-400 font-mono font-bold">
                  | Next request slot in {browserCountdown}s...
                </span>
              )}
            </div>
          </div>
        </div>

        {cooldownCountdown > 0 ? (
          <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-rose-950/80 border border-rose-800 text-rose-200 text-xs font-semibold animate-pulse">
            <AlertTriangle className="w-4 h-4 text-rose-400" />
            <span>429 Cooldown Active! Auto-resuming in {cooldownCountdown}s...</span>
          </div>
        ) : (
          <div className="text-xs font-mono text-slate-400 bg-slate-950/60 px-4 py-2 rounded-xl border border-slate-800">
            Worker State: <span className="text-amber-300 font-semibold">{isBrowserSyncActive ? browserTask : 'IDLE'}</span>
          </div>
        )}
      </div>

      {/* 3. Sub-Tab Section: Catalog Explorer vs Newly Added Log vs Inspector */}
      <div className="space-y-4">
        <div className="flex items-center gap-2 border-b border-slate-800 pb-2 overflow-x-auto">
          <button
            onClick={() => setActiveSubTab('explorer')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
              activeSubTab === 'explorer'
                ? 'bg-amber-500 text-slate-950 shadow-md'
                : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-white'
            }`}
          >
            <Compass className="w-4 h-4" />
            <span>Catalog Explorer &amp; Staging Preview</span>
          </button>

          <button
            onClick={() => setActiveSubTab('history')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
              activeSubTab === 'history'
                ? 'bg-amber-500 text-slate-950 shadow-md'
                : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-white'
            }`}
          >
            <Sparkles className="w-4 h-4" />
            <span>Riwayat Drama Baru Masuk (Newly Added)</span>
          </button>

          <button
            onClick={() => setActiveSubTab('inspector')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
              activeSubTab === 'inspector'
                ? 'bg-amber-500 text-slate-950 shadow-md'
                : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-white'
            }`}
          >
            <Terminal className="w-4 h-4" />
            <span>Endpoint Inspector</span>
          </button>
        </div>

        {activeSubTab === 'explorer' && (
          <CatalogExplorerStaging
            categories={categories}
            rateLimitSpeed={rateLimitSpeed}
            onImportComplete={onRefreshAllData}
          />
        )}

        {activeSubTab === 'history' && (
          <NewlyAddedHistory
            onPrioritizeDrama={(id) => {
              onPrioritizeDrama(id);
              if (!isBrowserSyncActive) runBrowserEpisodeSync();
            }}
            onRefreshData={onRefreshAllData}
          />
        )}

        {activeSubTab === 'inspector' && <EndpointInspector />}
      </div>

      {/* 4. Live Terminal Log Viewer */}
      <div className="bg-slate-950 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl">
        <div className="bg-slate-900 px-6 py-4 border-b border-slate-800 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Terminal className="w-5 h-5 text-amber-400" />
            <span className="text-sm font-bold text-white tracking-wide">Live Real-Time Sync Logs</span>
            <span className="text-xs text-slate-500 font-mono">({filteredLogs.length} lines)</span>
          </div>

          <div className="flex items-center gap-3">
            <input
              type="text"
              placeholder="Filter logs..."
              value={logFilter}
              onChange={(e) => setLogFilter(e.target.value)}
              className="bg-slate-950 border border-slate-800 text-xs text-slate-200 px-3 py-1.5 rounded-lg focus:outline-none focus:border-amber-500/50"
            />
            <button
              onClick={() => {
                setBrowserLogs([]);
                onClearLogs();
              }}
              title="Clear Terminal Logs"
              className="p-1.5 text-slate-400 hover:text-rose-400 transition-colors cursor-pointer"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="p-4 font-mono text-xs text-slate-300 bg-slate-950 h-64 overflow-y-auto space-y-1 select-text">
          {filteredLogs.length === 0 ? (
            <div className="text-slate-600 italic p-4 text-center">No logs generated yet. Click a sync button above.</div>
          ) : (
            filteredLogs.map((log, idx) => (
              <div
                key={idx}
                className={`py-0.5 leading-relaxed ${
                  log.includes('✔') || log.includes('SYNCED') || log.includes('Ingested') || log.includes('NEWLY')
                    ? 'text-emerald-400'
                    : log.includes('✖') || log.includes('FAILED') || log.includes('429')
                    ? 'text-rose-400 font-semibold'
                    : log.includes('STAGE') || log.includes('Syncing')
                    ? 'text-amber-300 font-bold'
                    : 'text-slate-400'
                }`}
              >
                {log}
              </div>
            ))
          )}
        </div>
      </div>

      {/* 5. Drama Sync Progress Table with Sorting */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl space-y-4 p-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-4">
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Database className="w-5 h-5 text-amber-400" />
              PineDrama Title Sync Progress
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Individual drama episode progress stored in MongoDB Atlas (`dracin_db`).
            </p>
          </div>

          {/* Sorting Dropdown */}
          <div className="flex items-center gap-2 bg-slate-950 p-1.5 rounded-xl border border-slate-800 text-xs">
            <ArrowUpDown className="w-4 h-4 text-amber-400 shrink-0 ml-1" />
            <span className="text-slate-400 font-semibold">Sortir:</span>
            <select
              value={sortOption}
              onChange={(e) => handleSortChangeInternal(e.target.value)}
              className="bg-slate-900 border border-slate-800 text-white font-semibold rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-amber-500 cursor-pointer"
            >
              <option value="importedAt_desc">Terbaru Ditambahkan ke DB</option>
              <option value="eps_desc">Total Episode Terbanyak</option>
              <option value="eps_asc">Total Episode Paling Sedikit</option>
              <option value="progress_desc">Progress Sync Episode</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm border-collapse">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400 text-xs font-semibold uppercase tracking-wider bg-slate-950/40">
                <th className="py-3 px-4">Drama Title</th>
                <th className="py-3 px-4">Category</th>
                <th className="py-3 px-4">Episodes Synced / Total</th>
                <th className="py-3 px-4">Progress Bar</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-slate-300">
              {dramas.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-500 italic">
                    No dramas in MongoDB yet. Use the Catalog Explorer above to preview and import PineDrama titles!
                  </td>
                </tr>
              ) : (
                dramas.map((drama) => {
                  const percentage =
                    drama.totalEpisodes > 0
                      ? Math.min(100, Math.round((drama.syncedEpisodesCount / drama.totalEpisodes) * 100))
                      : 0;

                  return (
                    <tr key={drama.dramaId} className="hover:bg-slate-800/40 transition-colors">
                      <td className="py-3.5 px-4 font-medium text-white max-w-xs truncate">
                        <div className="flex items-center gap-3">
                          <img
                            src={drama.coverUrl || 'https://via.placeholder.com/80x110'}
                            alt={drama.title}
                            className="w-10 h-14 object-cover rounded-lg bg-slate-800 shrink-0"
                            referrerPolicy="no-referrer"
                            onError={(e) => {
                              (e.target as HTMLElement).style.display = 'none';
                            }}
                          />
                          <div className="overflow-hidden">
                            <div className="flex items-center gap-2">
                              <span className="truncate">{drama.title}</span>
                              {drama.isNewlyAdded && (
                                <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[9px] font-bold tracking-wider shrink-0">
                                  NEW
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] text-slate-500 truncate">
                              ID: {drama.dramaId}
                            </div>
                          </div>
                        </div>
                      </td>

                      <td className="py-3.5 px-4 text-xs text-slate-400">
                        {drama.categories?.slice(0, 2).join(', ') || 'General'}
                      </td>

                      <td className="py-3.5 px-4 font-mono text-xs">
                        <span className="text-emerald-400 font-semibold">{drama.syncedEpisodesCount}</span> /{' '}
                        {drama.totalEpisodes} ({drama.pendingEpisodesCount} pending)
                      </td>

                      <td className="py-3.5 px-4 w-48">
                        <div className="space-y-1">
                          <div className="w-full bg-slate-950 h-2 rounded-full overflow-hidden border border-slate-800">
                            <div
                              className="bg-gradient-to-r from-amber-500 to-emerald-400 h-full transition-all duration-300"
                              style={{ width: `${percentage}%` }}
                            />
                          </div>
                          <div className="text-[10px] text-slate-400 text-right font-mono">{percentage}%</div>
                        </div>
                      </td>

                      <td className="py-3.5 px-4">
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-semibold ${
                            drama.syncStatus === 'COMPLETED'
                              ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                              : drama.syncStatus === 'PARTIAL'
                              ? 'bg-blue-950 text-blue-300 border border-blue-800'
                              : 'bg-amber-950 text-amber-300 border border-amber-800'
                          }`}
                        >
                          {drama.syncStatus}
                        </span>
                      </td>

                      <td className="py-3.5 px-4 text-right space-x-2">
                        <button
                          onClick={() => {
                            onPrioritizeDrama(drama.dramaId);
                            if (!isBrowserSyncActive) runBrowserEpisodeSync();
                          }}
                          disabled={drama.syncStatus === 'COMPLETED'}
                          className="px-3 py-1.5 rounded-lg bg-slate-800 text-amber-300 hover:bg-amber-500 hover:text-slate-950 text-xs font-semibold transition-all disabled:opacity-40 cursor-pointer"
                        >
                          Prioritize Title
                        </button>

                        <button
                          onClick={() => onSelectDrama(drama.dramaId)}
                          className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-200 text-xs font-semibold hover:bg-slate-700 transition-colors cursor-pointer"
                        >
                          View Episodes
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
