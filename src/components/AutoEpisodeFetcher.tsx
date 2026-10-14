import React, { useState, useEffect, useRef } from 'react';
import {
  Play,
  Pause,
  Zap,
  ShieldCheck,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Film,
  Layers,
  RefreshCw,
  Sparkles,
  Terminal,
  Trash2,
  Bot,
  Flame,
} from 'lucide-react';
import { resolveCoverUrl, handleImageError } from '../utils/imageUtils';

interface AutoEpisodeFetcherProps {
  onRefreshData: () => void;
}

export const AutoEpisodeFetcher: React.FC<AutoEpisodeFetcherProps> = ({ onRefreshData }) => {
  // Queue Selector: 'melolo' | 'pinedrama' | 'alternating'
  const [queueSource, setQueueSource] = useState<'melolo' | 'pinedrama' | 'alternating'>('melolo');

  // Speed Selector: 'SAFE' (5 req/min, 12.5s) vs 'FAST' (10 req/min, 6.5s)
  const [speedMode, setSpeedMode] = useState<'SAFE' | 'FAST'>('SAFE');

  // Sync Loop State
  const [isSyncActive, setIsSyncActive] = useState<boolean>(false);
  const [currentSyncItem, setCurrentSyncItem] = useState<any | null>(null);
  const [countdown, setCountdown] = useState<number>(0);
  const [cooldownCountdown, setCooldownCountdown] = useState<number>(0);
  const [logs, setLogs] = useState<string[]>([]);

  // Queue Counters
  const [pendingCount, setPendingCount] = useState<number>(0);
  const [syncedCount, setSyncedCount] = useState<number>(0);
  const [processedInSession, setProcessedInSession] = useState<number>(0);

  const syncActiveRef = useRef<boolean>(false);
  const delayMs = speedMode === 'SAFE' ? 12500 : 6500;

  const addLog = (msg: string) => {
    const time = new Date().toISOString().slice(11, 19);
    setLogs((prev) => [`[${time}] ${msg}`, ...prev.slice(0, 100)]);
  };

  // Fetch pending queue counts
  const fetchQueueCounts = async () => {
    try {
      const res = await fetch(`/api/sync/status?provider=${queueSource}`);
      const data = await res.json();
      if (data.success && data.counters) {
        setPendingCount(data.counters.pendingEpisodes || 0);
        setSyncedCount(data.counters.syncedEpisodes || 0);
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchQueueCounts();
  }, [queueSource]);

  // Main Isolated Streaming Fetch Loop
  const startAutoFetcher = async () => {
    if (syncActiveRef.current) return;
    syncActiveRef.current = true;
    setIsSyncActive(true);

    addLog(`🚀 [AUTO FETCHER STARTED] Queue: ${queueSource.toUpperCase()} | Speed: ${speedMode} (${delayMs / 1000}s slot)`);

    try {
      while (syncActiveRef.current) {
        // 1. Get next pending episode from backend
        const pendingRes = await fetch(`/api/sync/next-pending-episodes?limit=1&provider=${queueSource}`);
        const pendingData = await pendingRes.json();

        if (!pendingData.success || !pendingData.pendingEpisodes || pendingData.pendingEpisodes.length === 0) {
          addLog(`🎉 [QUEUE COMPLETED] All pending episodes in ${queueSource.toUpperCase()} queue synced!`);
          break;
        }

        const item = pendingData.pendingEpisodes[0];
        setCurrentSyncItem(item);

        const targetProvider = item.provider || 'melolo';
        const collectionId = item.collection_id || item.dramaId;
        const epNum = item.episodeNumber;
        let vid = item.video_id;
        const realTitle = item.dramaTitle || collectionId;

        addLog(`⚡ Processing [${targetProvider.toUpperCase()}] "${realTitle}" — Ep ${epNum}...`);

        let fetchUrl = '';

        if (targetProvider === 'melolo') {
          // Melolo Pipeline
          if (!vid) {
            addLog(`🔍 Missing vid for Melolo episode. Fetching detail for "${realTitle}" (book_id: ${collectionId})...`);
            try {
              const detailRes = await fetch(`https://api.sansekai.my.id/api/melolo/detail?book_id=${collectionId}&lang=id`, {
                headers: { Accept: '*/*' },
                referrerPolicy: 'no-referrer',
              });

              if (detailRes.status === 429) {
                addLog('⚠ [HTTP 429] Rate limit hit during Melolo detail fetch! Starting 60s cooldown...');
                await run429Cooldown();
                continue;
              }

              if (detailRes.ok) {
                const detailJson = await detailRes.json();
                await fetch('/api/dramas/update-melolo-detail', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    collection_id: collectionId,
                    rawDetail: detailJson,
                  }),
                });

                // Re-fetch next pending item to get newly extracted video_id
                const refreshedRes = await fetch(`/api/sync/next-pending-episodes?limit=1&provider=melolo&collection_id=${collectionId}`);
                const refreshedData = await refreshedRes.json();
                if (refreshedData.pendingEpisodes?.[0]?.video_id) {
                  vid = refreshedData.pendingEpisodes[0].video_id;
                  addLog(`✔ Successfully resolved vid: ${vid} for "${realTitle}" Ep ${epNum}!`);
                }
              }
            } catch (err: any) {
              addLog(`✖ Error fetching Melolo detail for vid resolution: ${err.message}`);
            }
          }

          if (vid) {
            fetchUrl = `https://api.sansekai.my.id/api/melolo/get-episode?videoId=${vid}`;
          } else {
            addLog(`✖ Unable to resolve videoId for Melolo episode ${epNum}. Marking failed.`);
            await fetch('/api/sync/save-episode', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                provider: 'melolo',
                collection_id: collectionId,
                episodeNumber: epNum,
                syncStatus: 'FAILED',
                errorMessage: 'Missing video_id (vid)',
              }),
            });
            await runSlotCountdown(delayMs / 1000);
            continue;
          }
        } else {
          // PineDrama Pipeline
          fetchUrl = `https://api.sansekai.my.id/api/pinedrama/get-episode?collection_id=${collectionId}&episodeNumber=${epNum}&lang=id`;
        }

        // 2. Browser Direct Fetch with Anti-403 Header Policy
        try {
          const streamRes = await fetch(fetchUrl, {
            method: 'GET',
            headers: { Accept: '*/*' },
            referrerPolicy: 'no-referrer',
            credentials: 'omit',
          });

          if (streamRes.status === 429) {
            addLog('⚠ [HTTP 429 Too Many Requests] Rate limit exceeded! Triggering 60s cooldown...');
            await run429Cooldown();
            continue;
          }

          if (streamRes.ok) {
            const jsonPayload = await streamRes.json();

            const saveRes = await fetch('/api/sync/save-episode', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                provider: targetProvider,
                collection_id: collectionId,
                episodeNumber: epNum,
                video_id: vid,
                rawResponse: jsonPayload,
              }),
            });

            const saveData = await saveRes.json();
            if (saveData.success) {
              setProcessedInSession((prev) => prev + 1);
              addLog(`✔ [SAVED TO DB] "${realTitle}" Ep ${epNum} stream link updated in ${targetProvider}_episodes!`);
            } else {
              addLog(`✖ [DB SAVE ERROR] "${realTitle}" Ep ${epNum}: ${saveData.error}`);
            }
          } else {
            addLog(`✖ [HTTP ${streamRes.status}] Failed fetching stream for "${realTitle}" Ep ${epNum}`);
            await fetch('/api/sync/save-episode', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                provider: targetProvider,
                collection_id: collectionId,
                episodeNumber: epNum,
                syncStatus: 'FAILED',
                errorMessage: `HTTP ${streamRes.status} from API`,
              }),
            });
          }
        } catch (fetchErr: any) {
          addLog(`✖ [FETCH EXCEPTION] "${realTitle}" Ep ${epNum}: ${fetchErr.message}`);
          await fetch('/api/sync/save-episode', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              provider: targetProvider,
              collection_id: collectionId,
              episodeNumber: epNum,
              syncStatus: 'FAILED',
              errorMessage: fetchErr.message,
            }),
          });
        }

        fetchQueueCounts();
        onRefreshData();

        // 3. Wait for Rate Limiter Slot
        await runSlotCountdown(delayMs / 1000);
      }
    } catch (err: any) {
      addLog(`✖ Auto Fetcher Error: ${err.message}`);
    } finally {
      syncActiveRef.current = false;
      setIsSyncActive(false);
      setCurrentSyncItem(null);
      fetchQueueCounts();
    }
  };

  const stopAutoFetcher = () => {
    syncActiveRef.current = false;
    setIsSyncActive(false);
    addLog('⏸ Auto Fetcher paused by user.');
  };

  const run429Cooldown = async () => {
    for (let sec = 60; sec > 0; sec--) {
      if (!syncActiveRef.current) break;
      setCooldownCountdown(sec);
      await new Promise((r) => setTimeout(r, 1000));
    }
    setCooldownCountdown(0);
    addLog('✔ 60-second cooldown complete! Automatically resuming fetch loop...');
  };

  const runSlotCountdown = async (seconds: number) => {
    for (let sec = Math.ceil(seconds); sec > 0; sec--) {
      if (!syncActiveRef.current) break;
      setCountdown(sec);
      await new Promise((r) => setTimeout(r, 1000));
    }
    setCountdown(0);
  };

  // Calculate Estimated Time Remaining (EST Time)
  const remainingSeconds = pendingCount * (delayMs / 1000);
  const estMinutes = Math.floor(remainingSeconds / 60);
  const estHours = Math.floor(estMinutes / 60);
  const displayEst =
    estHours > 0
      ? `${estHours} jam ${estMinutes % 60} min`
      : `${estMinutes} min ${Math.round(remainingSeconds % 60)} dtk`;

  const totalInQueue = syncedCount + pendingCount;
  const progressPercent = totalInQueue > 0 ? Math.round((syncedCount / totalInQueue) * 100) : 0;

  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-6 lg:p-8 space-y-6">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-900 to-amber-950/50 border border-amber-500/30 rounded-2xl p-6 shadow-2xl space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-4">
          <div>
            <h1 className="text-2xl font-black text-white flex items-center gap-3">
              <Bot className="w-7 h-7 text-amber-400" />
              🚀 Auto Episode Fetcher — Anti-403 Client Browser Pipeline
            </h1>
            <p className="text-xs text-slate-400 mt-1">
              Automated client-side video stream fetcher with rate-limiting, 429 auto-cooldown, and dedicated collection saving (`melolo_episodes` &amp; `pinedrama_episodes`).
            </p>
          </div>

          {/* Speed Selector */}
          <div className="bg-slate-950 p-1.5 rounded-xl border border-slate-800 flex items-center gap-2">
            <span className="text-xs text-slate-400 font-semibold px-2">Limiter Speed:</span>
            <button
              onClick={() => setSpeedMode('SAFE')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                speedMode === 'SAFE'
                  ? 'bg-emerald-500 text-slate-950 shadow-md'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Safe Mode (5 req/min · 12.5s)</span>
            </button>

            <button
              onClick={() => setSpeedMode('FAST')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                speedMode === 'FAST'
                  ? 'bg-amber-500 text-slate-950 shadow-md'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Zap className="w-3.5 h-3.5" />
              <span>Fast Mode (10 req/min · 6.5s)</span>
            </button>
          </div>
        </div>

        {/* Queue Selector & Controls */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
          <div className="md:col-span-5 bg-slate-950 p-3 rounded-xl border border-slate-800 flex items-center gap-3">
            <Layers className="w-5 h-5 text-amber-400 shrink-0" />
            <div className="flex-1">
              <label className="block text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-0.5">
                Pilih Antrean Koleksi
              </label>
              <select
                value={queueSource}
                onChange={(e: any) => setQueueSource(e.target.value)}
                disabled={isSyncActive}
                className="w-full bg-slate-900 border border-slate-800 text-white font-bold text-xs rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-amber-500 cursor-pointer disabled:opacity-50"
              >
                <option value="melolo">🍈 Koleksi Melolo (melolo_episodes)</option>
                <option value="pinedrama">🌲 Koleksi PineDrama (pinedrama_episodes)</option>
                <option value="alternating">🔄 Bergantian (Melolo &amp; PineDrama)</option>
              </select>
            </div>
          </div>

          <div className="md:col-span-7 flex items-center gap-3">
            <button
              onClick={startAutoFetcher}
              disabled={isSyncActive}
              className="flex-1 flex items-center justify-center gap-3 px-6 py-3.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-black text-sm transition-all shadow-lg shadow-emerald-600/20 disabled:opacity-50 cursor-pointer"
            >
              <Play className="w-5 h-5 fill-current" />
              <span>Jalankan Auto Fetcher ({queueSource.toUpperCase()})</span>
            </button>

            <button
              onClick={stopAutoFetcher}
              disabled={!isSyncActive}
              className="px-5 py-3.5 rounded-xl bg-slate-800 border border-slate-700 hover:bg-slate-700 text-slate-200 font-bold text-sm transition-all disabled:opacity-50 cursor-pointer flex items-center gap-2"
            >
              <Pause className="w-5 h-5 fill-current" />
              <span>Pause</span>
            </button>
          </div>
        </div>
      </div>

      {/* Telemetry Stats & Progress Bar */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex items-center gap-3">
          <div className="p-3 bg-amber-500/10 rounded-xl text-amber-400 border border-amber-500/20">
            <Clock className="w-6 h-6" />
          </div>
          <div>
            <div className="text-xl font-black text-white font-mono">{pendingCount}</div>
            <div className="text-[11px] text-slate-400 font-semibold uppercase">Pending Episodes</div>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex items-center gap-3">
          <div className="p-3 bg-emerald-500/10 rounded-xl text-emerald-400 border border-emerald-500/20">
            <CheckCircle2 className="w-6 h-6" />
          </div>
          <div>
            <div className="text-xl font-black text-white font-mono">{syncedCount}</div>
            <div className="text-[11px] text-slate-400 font-semibold uppercase">Synced Episodes</div>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex items-center gap-3">
          <div className="p-3 bg-blue-500/10 rounded-xl text-blue-400 border border-blue-500/20">
            <Flame className="w-6 h-6" />
          </div>
          <div>
            <div className="text-xl font-black text-white font-mono">{processedInSession}</div>
            <div className="text-[11px] text-slate-400 font-semibold uppercase">Done This Session</div>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex items-center gap-3">
          <div className="p-3 bg-indigo-500/10 rounded-xl text-indigo-400 border border-indigo-500/20">
            <Sparkles className="w-6 h-6" />
          </div>
          <div>
            <div className="text-xl font-black text-amber-300 font-mono">{displayEst}</div>
            <div className="text-[11px] text-slate-400 font-semibold uppercase">EST Completion Time</div>
          </div>
        </div>
      </div>

      {/* Progress Bar & Current Active Item Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
        <div className="flex items-center justify-between text-xs font-semibold text-slate-400">
          <span>Overall Queue Progress ({progressPercent}%)</span>
          <span className="font-mono text-emerald-400">{syncedCount} / {totalInQueue} Synced</span>
        </div>
        <div className="w-full bg-slate-950 h-3 rounded-full overflow-hidden border border-slate-800">
          <div
            className="bg-gradient-to-r from-amber-500 via-teal-400 to-emerald-400 h-full transition-all duration-500"
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        {/* 429 Cooldown Banner */}
        {cooldownCountdown > 0 && (
          <div className="bg-rose-950/90 border border-rose-800 rounded-xl p-4 flex items-center justify-between text-xs text-rose-200 animate-pulse">
            <div className="flex items-center gap-3 font-bold">
              <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />
              <span>HTTP 429 Rate Limit Triggered! Auto-Cooldown in progress...</span>
            </div>
            <span className="font-mono text-sm font-black bg-rose-900 px-3 py-1 rounded-lg border border-rose-700">
              Resuming in {cooldownCountdown}s
            </span>
          </div>
        )}

        {/* Live Active Episode Card */}
        {currentSyncItem ? (
          <div className="bg-slate-950 border border-amber-500/30 rounded-xl p-4 flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <img
                src={resolveCoverUrl(currentSyncItem.coverUrl)}
                alt={currentSyncItem.dramaTitle}
                className="w-14 h-20 object-cover rounded-xl bg-slate-900 border border-slate-800 shrink-0"
                referrerPolicy="no-referrer"
                onError={(e) => handleImageError(e, currentSyncItem.coverUrl)}
              />
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${
                      currentSyncItem.provider === 'melolo'
                        ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
                        : 'bg-indigo-950 text-indigo-300 border-indigo-800'
                    }`}
                  >
                    {currentSyncItem.provider === 'melolo' ? '🍈 MELOLO' : '🌲 PINEDRAMA'}
                  </span>
                  <span className="text-xs font-mono text-slate-400">ID: {currentSyncItem.collection_id}</span>
                </div>
                <h3 className="text-base font-bold text-white tracking-wide">{currentSyncItem.dramaTitle}</h3>
                <div className="text-xs text-amber-300 font-semibold flex items-center gap-2">
                  <Film className="w-3.5 h-3.5" />
                  <span>Episode {currentSyncItem.episodeNumber}</span>
                  {currentSyncItem.video_id && (
                    <span className="text-slate-500 font-mono text-[11px]">(vid: {currentSyncItem.video_id})</span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3 font-mono text-xs text-slate-300 bg-slate-900 px-4 py-2 rounded-xl border border-slate-800 shrink-0">
              <RefreshCw className="w-4 h-4 text-amber-400 animate-spin" />
              <span>
                {countdown > 0 ? (
                  <span className="text-emerald-400 font-bold">Slot delay: {countdown}s</span>
                ) : (
                  <span>Fetching stream URL...</span>
                )}
              </span>
            </div>
          </div>
        ) : (
          <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-4 text-center text-xs text-slate-500 italic">
            Fetcher is currently resting. Click "Jalankan Auto Fetcher" to start streaming link collection.
          </div>
        )}
      </div>

      {/* Terminal Live Logs */}
      <div className="bg-slate-950 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl">
        <div className="bg-slate-900 px-6 py-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Terminal className="w-5 h-5 text-amber-400" />
            <span className="text-sm font-bold text-white">Auto Fetcher Real-Time Logs</span>
            <span className="text-xs text-slate-500 font-mono">({logs.length} lines)</span>
          </div>

          <button
            onClick={() => setLogs([])}
            className="p-1.5 text-slate-400 hover:text-rose-400 transition-colors cursor-pointer"
            title="Clear Logs"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 font-mono text-xs bg-slate-950 h-64 overflow-y-auto space-y-1 select-text">
          {logs.length === 0 ? (
            <div className="text-slate-600 italic text-center p-6">No logs generated yet. Click start above.</div>
          ) : (
            logs.map((log, idx) => (
              <div
                key={idx}
                className={`py-0.5 leading-relaxed ${
                  log.includes('✔') || log.includes('SAVED') || log.includes('COMPLETED')
                    ? 'text-emerald-400'
                    : log.includes('✖') || log.includes('429') || log.includes('ERROR')
                    ? 'text-rose-400 font-semibold'
                    : log.includes('STARTED') || log.includes('Processing')
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
    </div>
  );
};
