import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import axios from 'axios';
import {
  Cloud,
  CloudUpload,
  Play,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Film,
  HardDrive,
  ExternalLink,
  Layers,
  Sparkles,
  Loader2,
  X,
  Bot,
  AlertTriangle,
  StopCircle,
  Search,
  Copy,
  Check,
  RotateCcw,
} from 'lucide-react';
import { resolveCoverUrl, handleImageError } from '../utils/imageUtils';
import { useTerminal } from '../context/TerminalContext';

export interface GDriveEpisodeItem {
  provider: 'pinedrama' | 'melolo';
  dramaId: string;
  collection_id?: string;
  book_id?: string;
  episodeNumber: number;
  title?: string;
  dramaTitle?: string;
  dramaCover?: string;
  streamUrl?: string | null;
  gdriveFileId?: string | null;
  gdriveViewLink?: string | null;
  gdriveDirectLink?: string | null;
  syncStatus?: string;
  updatedAt?: string;
  isMock?: boolean;
}

export const GDriveSyncManager: React.FC = () => {
  const { addLog } = useTerminal();
  const [episodes, setEpisodes] = useState<GDriveEpisodeItem[]>([]);
  const [providerFilter, setProviderFilter] = useState<'all' | 'pinedrama' | 'melolo'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'backed_up' | 'mock' | 'missing'>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);

  // Single backup / resync in progress tracking
  const [backingUpEpKey, setBackingUpEpKey] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Live Mass Sync Progress State
  const [isMassSyncing, setIsMassSyncing] = useState<boolean>(false);
  const [totalToSync, setTotalToSync] = useState<number>(0);
  const [currentSyncIndex, setCurrentSyncIndex] = useState<number>(0);
  const [currentSyncTitle, setCurrentSyncTitle] = useState<string>('');
  const [syncSuccessCount, setSyncSuccessCount] = useState<number>(0);
  const [syncFailedCount, setSyncFailedCount] = useState<number>(0);
  const [cooldownSeconds, setCooldownSeconds] = useState<number>(0);
  const [isCancelled, setIsCancelled] = useState<boolean>(false);

  // Cancellation ref for immediate loop breaking across async ticks
  const isCancelledRef = useRef<boolean>(false);

  // Preview Modal
  const [previewEp, setPreviewEp] = useState<GDriveEpisodeItem | null>(null);

  // Fetch episodes from backend
  const fetchGDriveEpisodes = useCallback(
    async (isUserTriggered = false) => {
      setIsLoading(true);
      if (isUserTriggered) {
        addLog(
          'info',
          `[GDrive Sync] Memuat daftar episode Google Drive (Provider: ${providerFilter}, Status: ${statusFilter})...`
        );
      }
      try {
        const url = new URL('/api/drive/episodes', window.location.origin);
        if (providerFilter !== 'all') url.searchParams.set('provider', providerFilter);
        if (statusFilter !== 'all') url.searchParams.set('status', statusFilter);
        if (searchQuery.trim()) url.searchParams.set('q', searchQuery.trim());
        url.searchParams.set('limit', '500');

        const response = await axios.get(url.toString(), { timeout: 30000 });
        const data = response.data;
        if (data && data.success && Array.isArray(data.items)) {
          setEpisodes(data.items);
          if (isUserTriggered) {
            const ready = data.items.filter((e: any) => e.gdriveFileId && !e.isMock).length;
            const mocks = data.items.filter((e: any) => e.isMock).length;
            addLog(
              'info',
              `[GDrive Sync] Selesai memuat ${data.items.length} episode (${ready} Ready, ${mocks} Mock Data).`
            );
          }
        }
      } catch (err: any) {
        console.error('Error fetching GDrive episodes:', err);
        const errMsg = err.response?.data?.error || err.message || 'Network error';
        addLog('error', `[GDrive Sync] Gagal memuat daftar episode: ${errMsg}`, err.stack);
      } finally {
        setIsLoading(false);
      }
    },
    [providerFilter, statusFilter, searchQuery, addLog]
  );

  useEffect(() => {
    fetchGDriveEpisodes();
  }, [fetchGDriveEpisodes]);

  // Copy to clipboard helper
  const handleCopyLink = async (key: string, text: string) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2000);
    } catch (err) {
      console.error(err);
    }
  };

  // Single Episode Backup / Force Resync to GDrive
  const handleSingleBackup = async (ep: GDriveEpisodeItem, forceResync = false) => {
    const dId = ep.dramaId || ep.collection_id || ep.book_id || '';
    const key = `${ep.provider}_${dId}_ep${ep.episodeNumber}`;
    const dramaName = ep.dramaTitle || `Drama ${dId}`;
    setBackingUpEpKey(key);

    const actionType = forceResync || ep.isMock ? 'FORCE RESYNC' : 'BACKUP';
    addLog(
      'info',
      `[GDrive ${actionType}] Memulai proses upload untuk [${ep.provider.toUpperCase()}] "${dramaName}" Ep ${ep.episodeNumber}...`,
      {
        provider: ep.provider,
        dramaId: dId,
        episodeNumber: ep.episodeNumber,
        streamUrl: ep.streamUrl,
        isMock: ep.isMock,
        forceResync,
      }
    );

    try {
      const response = await axios.post(
        '/api/drive/auto-backup',
        {
          dramaId: dId,
          provider: ep.provider,
          episodeNumber: ep.episodeNumber,
          streamUrl: ep.streamUrl,
          dramaTitle: ep.dramaTitle,
          forceResync: true, // Always force fresh upload to overwrite mock
        },
        { timeout: 180000 }
      );

      const data = response.data;
      if (data && data.success && data.data) {
        addLog(
          'success',
          `[GDrive ${actionType}] Berhasil! [${ep.provider.toUpperCase()}] "${dramaName}" Ep ${ep.episodeNumber} kini tersimpan di Google Drive! (ID: ${data.data.fileId})`,
          data.data
        );

        // Update local state row immediately
        setEpisodes((prev) =>
          prev.map((item) => {
            const itemId = item.dramaId || item.collection_id || item.book_id;
            if (item.provider === ep.provider && itemId === dId && item.episodeNumber === ep.episodeNumber) {
              return {
                ...item,
                gdriveFileId: data.data.fileId,
                gdriveViewLink: data.data.webViewLink,
                gdriveDirectLink: data.data.gdriveDirectLink,
                syncStatus: 'BACKED_UP_GDRIVE',
                isMock: false,
              };
            }
            return item;
          })
        );
      } else {
        const errorMsg = data?.error || 'Terjadi kesalahan saat upload ke Google Drive';
        const errorDetails = data?.details || JSON.stringify(data, null, 2);
        addLog(
          'error',
          `[GDrive ${actionType}] GAGAL pada [${ep.provider.toUpperCase()}] "${dramaName}" Ep ${ep.episodeNumber}: ${errorMsg}`,
          errorDetails
        );
      }
    } catch (err: any) {
      const errorMsg = err.response?.data?.error || err.message || 'Network / timeout error';
      const errorDetails = err.response?.data?.details || err.stack;
      addLog(
        'error',
        `[GDrive ${actionType}] Exception network [Ep ${ep.episodeNumber}]: ${errorMsg}`,
        errorDetails
      );
    } finally {
      setBackingUpEpKey(null);
    }
  };

  // Compute episodes that need backup (missing OR mock data)
  const episodesToSync = useMemo(() => {
    return episodes.filter((ep) => {
      const isMissing = !ep.gdriveFileId || ep.gdriveFileId.trim() === '';
      const isMock = ep.isMock || Boolean(ep.gdriveFileId && ep.gdriveFileId.toLowerCase().includes('mock'));
      const hasStream = Boolean(ep.streamUrl);
      return (isMissing || isMock) && hasStream;
    });
  }, [episodes]);

  // Bulk Sequential Backup (for...of Loop with Live Progress Bar & Per-Episode Try-Catch)
  const handleBackupAllMissing = async () => {
    if (episodesToSync.length === 0) {
      addLog('info', 'Semua episode yang tampil sudah ter-backup di Google Drive dengan ID valid!');
      alert('Semua episode dalam filter saat ini sudah ter-backup dengan ID valid (tidak ada mock/missing).');
      return;
    }

    isCancelledRef.current = false;
    setIsCancelled(false);
    setIsMassSyncing(true);
    setTotalToSync(episodesToSync.length);
    setCurrentSyncIndex(0);
    setSyncSuccessCount(0);
    setSyncFailedCount(0);
    setCurrentSyncTitle(`Menyiapkan ${episodesToSync.length} episode...`);

    addLog(
      'info',
      `🚀 [GDrive Batch Backup] Memulai proses sekuensial untuk ${episodesToSync.length} episode (Missing + Mock Data) dengan jeda nafas 4 detik antar-request...`
    );

    let successes = 0;
    let fails = 0;

    // Sequential loop over episodesToSync
    for (const [index, ep] of episodesToSync.entries()) {
      if (isCancelledRef.current || isCancelled) {
        addLog(
          'warn',
          `🛑 [GDrive Batch Backup] Dihentikan oleh pengguna pada item ke-${index + 1} dari ${episodesToSync.length}.`
        );
        break;
      }

      const dId = ep.dramaId || ep.collection_id || ep.book_id || '';
      const dramaName = ep.dramaTitle || `Drama ${dId}`;
      const epKey = `${ep.provider}_${dId}_ep${ep.episodeNumber}`;

      setCurrentSyncIndex(index + 1);
      setCurrentSyncTitle(`[${ep.provider.toUpperCase()}] ${dramaName} — Ep ${ep.episodeNumber}`);
      setBackingUpEpKey(epKey);

      try {
        addLog(
          'info',
          `[Batch ${index + 1}/${episodesToSync.length}] Memulai backup [${ep.provider.toUpperCase()}] "${dramaName}" Ep ${ep.episodeNumber}...`
        );

        const response = await axios.post(
          '/api/drive/auto-backup',
          {
            dramaId: dId,
            provider: ep.provider,
            episodeNumber: ep.episodeNumber,
            streamUrl: ep.streamUrl,
            dramaTitle: ep.dramaTitle,
            forceResync: true, // Overwrites any previous mock ID
          },
          { timeout: 180000 }
        );

        const data = response.data;
        if (data && data.success && data.data) {
          successes++;
          setSyncSuccessCount(successes);
          addLog(
            'success',
            `✔ [Batch ${index + 1}/${episodesToSync.length}] "${dramaName}" Ep ${ep.episodeNumber} BERHASIL di-backup! (ID: ${data.data.fileId})`
          );

          // Update local state in-place
          setEpisodes((prev) =>
            prev.map((item) => {
              const itemId = item.dramaId || item.collection_id || item.book_id;
              if (item.provider === ep.provider && itemId === dId && item.episodeNumber === ep.episodeNumber) {
                return {
                  ...item,
                  gdriveFileId: data.data.fileId,
                  gdriveViewLink: data.data.webViewLink,
                  gdriveDirectLink: data.data.gdriveDirectLink,
                  syncStatus: 'BACKED_UP_GDRIVE',
                  isMock: false,
                };
              }
              return item;
            })
          );
        } else {
          fails++;
          setSyncFailedCount(fails);
          const errDetail = data?.error || 'Upload error';
          addLog(
            'error',
            `✖ [Batch ${index + 1}/${episodesToSync.length}] Gagal "${dramaName}" Ep ${ep.episodeNumber}: ${errDetail} (Melanjutkan ke episode berikutnya...)`,
            data?.details
          );
        }
      } catch (err: any) {
        // TANGKAP ERROR PER-EPISODE AGAR LOOPING TIDAK BERHENTI (Resilient to network timeouts & Failed to fetch)
        fails++;
        setSyncFailedCount(fails);
        const errMsg = err.response?.data?.error || err.message || 'Failed to fetch / Timeout';
        const errDetails = err.response?.data?.details || err.stack;
        addLog(
          'error',
          `✖ [Batch ${index + 1}/${episodesToSync.length}] Terkena kendala network pada Ep ${ep.episodeNumber}: ${errMsg}. Sistem tetap melanjutkan ke episode berikutnya!`,
          errDetails
        );
      } finally {
        setBackingUpEpKey(null);
      }

      // JEDA NAFAS WAJIB (Cooldown 4 Detik) untuk mereset rate-limit CDN & Google Drive
      if (index < episodesToSync.length - 1 && !isCancelledRef.current) {
        for (let sec = 4; sec > 0; sec--) {
          if (isCancelledRef.current) break;
          setCooldownSeconds(sec);
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        setCooldownSeconds(0);
      }
    }

    setBackingUpEpKey(null);
    setCooldownSeconds(0);
    setIsMassSyncing(false);
    addLog(
      'info',
      `🏁 [GDrive Batch Backup Selesai] Total: ${episodesToSync.length} | Berhasil: ${successes} | Gagal: ${fails}`
    );
  };

  const handleStopMassSync = () => {
    isCancelledRef.current = true;
    setIsCancelled(true);
    addLog('warn', '🛑 Mengirim sinyal penghentian proses backup masal...');
  };

  // Calculate live counters
  const totalCount = episodes.length;
  const mockCount = episodes.filter(
    (e) => e.isMock || Boolean(e.gdriveFileId && e.gdriveFileId.toLowerCase().includes('mock'))
  ).length;
  const readyCount = episodes.filter(
    (e) => e.gdriveFileId && !e.isMock && !e.gdriveFileId.toLowerCase().includes('mock')
  ).length;
  const pendingCount = episodes.filter((e) => !e.gdriveFileId || e.gdriveFileId.trim() === '').length;
  const needsResyncCount = episodesToSync.length;

  // Filtered in-memory list for instant search
  const displayedEpisodes = useMemo(() => {
    return episodes.filter((ep) => {
      const matchProvider = providerFilter === 'all' || ep.provider === providerFilter;
      const isMockItem = Boolean(ep.isMock || (ep.gdriveFileId && ep.gdriveFileId.toLowerCase().includes('mock')));
      const isReadyItem = Boolean(ep.gdriveFileId && !isMockItem);
      const isMissingItem = Boolean(!ep.gdriveFileId || ep.gdriveFileId.trim() === '');

      let matchStatus = true;
      if (statusFilter === 'backed_up') matchStatus = isReadyItem;
      if (statusFilter === 'mock') matchStatus = isMockItem;
      if (statusFilter === 'missing') matchStatus = isMissingItem;

      const q = searchQuery.trim().toLowerCase();
      const matchSearch =
        !q ||
        (ep.dramaTitle && ep.dramaTitle.toLowerCase().includes(q)) ||
        String(ep.dramaId || '').toLowerCase().includes(q) ||
        String(ep.gdriveFileId || '').toLowerCase().includes(q);

      return matchProvider && matchStatus && matchSearch;
    });
  }, [episodes, providerFilter, statusFilter, searchQuery]);

  const progressPercent = totalToSync > 0 ? Math.round((currentSyncIndex / totalToSync) * 100) : 0;

  return (
    <div className="min-h-screen text-slate-100 p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      {/* Header Banner */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-slate-900 to-cyan-950/80 border border-slate-800 p-6 sm:p-10 shadow-2xl">
        <div className="relative z-10 max-w-3xl space-y-4">
          <div className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-cyan-400 bg-cyan-500/10 px-3 py-1 rounded-full border border-cyan-500/20">
            <Cloud className="w-3.5 h-3.5" />
            <span>GDrive Auto-Backup &amp; Streaming Pipeline</span>
          </div>

          <h1 className="text-3xl sm:text-5xl font-black text-white tracking-tight leading-tight">
            ☁️ GDrive Sync <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-teal-400 to-emerald-400">Manager</span>
          </h1>

          <p className="text-slate-300 text-sm sm:text-base leading-relaxed">
            Streaming &amp; upload otomatis video CDN Sansekai langsung ke Google Drive Anda via Stream Piping. Bebas limit memori server dan anti URL kadaluarsa.
          </p>

          <div className="flex flex-wrap items-center gap-3 pt-2">
            {!isMassSyncing ? (
              <button
                onClick={handleBackupAllMissing}
                disabled={needsResyncCount === 0}
                className="flex items-center gap-2 px-5 py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-emerald-500 hover:from-cyan-400 hover:to-emerald-400 text-slate-950 font-bold text-sm shadow-xl shadow-cyan-500/20 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <CloudUpload className="w-4 h-4" />
                <span>
                  Backup All Missing &amp; Mock Episodes to GDrive ({needsResyncCount})
                </span>
              </button>
            ) : (
              <button
                onClick={handleStopMassSync}
                className="flex items-center gap-2 px-5 py-3 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-sm shadow-xl shadow-rose-600/30 transition-all cursor-pointer animate-pulse"
              >
                <StopCircle className="w-4 h-4" />
                <span>⏹ Hentikan Backup Masal</span>
              </button>
            )}

            <button
              onClick={() => fetchGDriveEpisodes(true)}
              className="flex items-center gap-2 px-4 py-3 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white font-semibold text-sm transition-all cursor-pointer"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-cyan-400' : ''}`} />
              <span>Refresh Status</span>
            </button>
          </div>
        </div>

        <div className="absolute -right-12 -bottom-12 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />
      </div>

      {/* 🚀 Dynamic Live Progress Bar Card for Mass Backup */}
      {isMassSyncing && (
        <div className="bg-slate-900 border-2 border-cyan-500/50 p-5 rounded-2xl shadow-2xl space-y-4 animate-in fade-in duration-300">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <Loader2 className="w-4 h-4 animate-spin text-cyan-400" />
                <span className="text-sm font-black text-cyan-300 uppercase tracking-wide">
                  Live Mass GDrive Backup in Progress
                </span>
                <span className="px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 text-xs font-mono font-bold">
                  {progressPercent}%
                </span>
                {cooldownSeconds > 0 && (
                  <span className="px-2.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 text-xs font-mono font-black animate-pulse">
                    ⏳ Jeda Nafas: {cooldownSeconds} detik...
                  </span>
                )}
              </div>
              <div className="text-xs font-mono text-slate-300 truncate max-w-xl">
                {cooldownSeconds > 0 ? (
                  <span className="text-amber-300">
                    Mereset rate-limit CDN &amp; GDrive ({cooldownSeconds}s) sebelum lanjut ke episode berikutnya...
                  </span>
                ) : (
                  <>
                    Mengunggah {currentSyncIndex} dari {totalToSync}: <strong className="text-white">{currentSyncTitle}</strong>
                  </>
                )}
              </div>
            </div>

            <div className="flex items-center gap-3 font-mono text-xs">
              <span className="px-2.5 py-1 rounded-lg bg-emerald-950/80 text-emerald-300 border border-emerald-800/60 font-bold">
                ✔ Berhasil: {syncSuccessCount}
              </span>
              <span className="px-2.5 py-1 rounded-lg bg-rose-950/80 text-rose-300 border border-rose-800/60 font-bold">
                ✖ Gagal: {syncFailedCount}
              </span>
              <button
                onClick={handleStopMassSync}
                className="px-3 py-1 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs transition-all cursor-pointer"
              >
                Hentikan
              </button>
            </div>
          </div>

          {/* Visual Progress Bar */}
          <div className="w-full bg-slate-950 rounded-full h-3 overflow-hidden p-0.5 border border-slate-800">
            <div
              className="bg-gradient-to-r from-cyan-500 via-teal-400 to-emerald-400 h-full rounded-full transition-all duration-300 shadow-lg shadow-cyan-500/50"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      )}

      {/* Stats Counter Bar with Quick-Filter Clicks */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
        {/* Total */}
        <button
          onClick={() => setStatusFilter('all')}
          className={`p-4 rounded-2xl border text-left transition-all cursor-pointer ${
            statusFilter === 'all'
              ? 'bg-slate-800/90 border-cyan-500 shadow-lg shadow-cyan-500/10'
              : 'bg-slate-900/80 border-slate-800 hover:bg-slate-800/50'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Total Synced Video</span>
            <Film className="w-4 h-4 text-slate-400" />
          </div>
          <div className="text-2xl font-black text-white mt-2">{totalCount}</div>
          <div className="text-[10px] text-slate-500 mt-0.5">Semua episode ber-stream</div>
        </button>

        {/* Ready */}
        <button
          onClick={() => setStatusFilter('backed_up')}
          className={`p-4 rounded-2xl border text-left transition-all cursor-pointer ${
            statusFilter === 'backed_up'
              ? 'bg-emerald-950/60 border-emerald-500 shadow-lg shadow-emerald-500/10'
              : 'bg-slate-900/80 border-slate-800 hover:bg-slate-800/50'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider">Ready in Drive</span>
            <Cloud className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-black text-emerald-400 mt-2">{readyCount}</div>
          <div className="text-[10px] text-emerald-400/70 mt-0.5">ID Google Drive valid</div>
        </button>

        {/* Mock Data */}
        <button
          onClick={() => setStatusFilter('mock')}
          className={`p-4 rounded-2xl border text-left transition-all cursor-pointer ${
            statusFilter === 'mock'
              ? 'bg-rose-950/70 border-rose-500 shadow-lg shadow-rose-500/20 ring-1 ring-rose-500'
              : 'bg-slate-900/80 border-rose-900/40 hover:bg-rose-950/30'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-rose-400 uppercase tracking-wider flex items-center gap-1">
              <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
              <span>Mock Data</span>
            </span>
            <span className="px-1.5 py-0.5 rounded text-[10px] font-black bg-rose-600 text-white">Perlu Resync</span>
          </div>
          <div className="text-2xl font-black text-rose-400 mt-2">{mockCount}</div>
          <div className="text-[10px] text-rose-300/80 mt-0.5">ID dummy/mock sebelumnya</div>
        </button>

        {/* Pending Backup */}
        <button
          onClick={() => setStatusFilter('missing')}
          className={`p-4 rounded-2xl border text-left transition-all cursor-pointer ${
            statusFilter === 'missing'
              ? 'bg-amber-950/60 border-amber-500 shadow-lg shadow-amber-500/10'
              : 'bg-slate-900/80 border-slate-800 hover:bg-slate-800/50'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-amber-400 uppercase tracking-wider">Pending Backup</span>
            <CloudUpload className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-2xl font-black text-amber-400 mt-2">{pendingCount}</div>
          <div className="text-[10px] text-amber-400/70 mt-0.5">Hanya ada di CDN</div>
        </button>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4 bg-slate-900/70 border border-slate-800 p-4 rounded-2xl">
        {/* Provider Filters */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-400 mr-1">
            <Layers className="w-3.5 h-3.5 text-cyan-400" />
            <span>Provider:</span>
          </div>
          <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800">
            <button
              onClick={() => setProviderFilter('all')}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                providerFilter === 'all' ? 'bg-cyan-500 text-slate-950 font-black' : 'text-slate-400 hover:text-white'
              }`}
            >
              Semua
            </button>
            <button
              onClick={() => setProviderFilter('pinedrama')}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                providerFilter === 'pinedrama' ? 'bg-indigo-600 text-white font-black' : 'text-slate-400 hover:text-white'
              }`}
            >
              PineDrama
            </button>
            <button
              onClick={() => setProviderFilter('melolo')}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                providerFilter === 'melolo' ? 'bg-emerald-600 text-white font-black' : 'text-slate-400 hover:text-white'
              }`}
            >
              Melolo
            </button>
          </div>
        </div>

        {/* Status Filters */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Status:</span>
          <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800">
            <button
              onClick={() => setStatusFilter('all')}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                statusFilter === 'all' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              Semua
            </button>
            <button
              onClick={() => setStatusFilter('backed_up')}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                statusFilter === 'backed_up' ? 'bg-emerald-500 text-slate-950 font-black' : 'text-slate-400 hover:text-white'
              }`}
            >
              ☁️ Ready ({readyCount})
            </button>
            <button
              onClick={() => setStatusFilter('mock')}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                statusFilter === 'mock' ? 'bg-rose-500 text-white font-black animate-pulse' : 'text-rose-400 hover:text-rose-200'
              }`}
            >
              ⚠️ Mock ({mockCount})
            </button>
            <button
              onClick={() => setStatusFilter('missing')}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                statusFilter === 'missing' ? 'bg-amber-500 text-slate-950 font-black' : 'text-slate-400 hover:text-white'
              }`}
            >
              ⏳ Belum ({pendingCount})
            </button>
          </div>
        </div>

        {/* Search Input */}
        <div className="relative min-w-[200px]">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Cari judul drama / ID..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 bg-slate-950 border border-slate-800 rounded-xl text-xs font-mono text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500"
          />
        </div>
      </div>

      {/* 📋 GDrive Episode List Table with Force Resync Action */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl">
        <div className="px-5 py-3.5 bg-slate-950/80 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <HardDrive className="w-4 h-4 text-cyan-400" />
            <h2 className="text-sm font-black text-white uppercase tracking-wider">
              Daftar Episode &amp; Status Google Drive ({displayedEpisodes.length})
            </h2>
          </div>
          <div className="text-[11px] font-mono text-slate-400">
            Diprioritaskan: <span className="text-rose-400 font-bold">Mock Data</span> ➔ <span className="text-amber-400 font-bold">Pending</span> ➔ <span className="text-emerald-400 font-bold">Ready</span>
          </div>
        </div>

        {isLoading ? (
          <div className="p-16 text-center text-slate-400 flex flex-col items-center gap-3">
            <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
            <span className="text-sm font-semibold font-mono">Memuat database episode Google Drive...</span>
          </div>
        ) : displayedEpisodes.length === 0 ? (
          <div className="p-16 text-center text-slate-400 space-y-3">
            <Cloud className="w-12 h-12 text-slate-600 mx-auto" />
            <div className="text-slate-300 font-bold text-base">Tidak ada episode yang sesuai filter</div>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              Cobalah ubah filter status atau pastikan Anda telah melakukan sync episode dari Sansekai pada tab Auto Episode Fetcher.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs sm:text-sm">
              <thead className="bg-slate-950 text-slate-400 uppercase text-[10px] tracking-wider font-bold border-b border-slate-800 select-none">
                <tr>
                  <th className="px-4 py-3">Drama &amp; Cover</th>
                  <th className="px-4 py-3">Provider</th>
                  <th className="px-4 py-3">Episode #</th>
                  <th className="px-4 py-3">GDrive Status</th>
                  <th className="px-4 py-3">File ID / Link</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-medium font-sans">
                {displayedEpisodes.map((ep, idx) => {
                  const dId = ep.dramaId || ep.collection_id || ep.book_id || '';
                  const rowKey = `${ep.provider}_${dId}_ep${ep.episodeNumber}`;
                  const isBackingUp = backingUpEpKey === rowKey;
                  const isMock = ep.isMock || Boolean(ep.gdriveFileId && ep.gdriveFileId.toLowerCase().includes('mock'));
                  const isReady = ep.gdriveFileId && !isMock;

                  return (
                    <tr
                      key={`${rowKey}_${idx}`}
                      className={`transition-colors ${
                        isMock
                          ? 'bg-rose-950/20 hover:bg-rose-950/30 border-l-4 border-rose-500'
                          : isReady
                          ? 'hover:bg-slate-800/40'
                          : 'bg-amber-950/10 hover:bg-amber-950/20 border-l-4 border-amber-500/50'
                      }`}
                    >
                      {/* Column 1: Drama Title & Cover */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <img
                            src={resolveCoverUrl(ep.dramaCover || '')}
                            alt={ep.dramaTitle}
                            className="w-10 h-14 object-cover rounded-lg bg-slate-950 shrink-0 border border-slate-800"
                            referrerPolicy="no-referrer"
                            onError={(e) => handleImageError(e, ep.dramaCover || '')}
                          />
                          <div className="space-y-0.5 min-w-0">
                            <div className="font-bold text-white max-w-[190px] sm:max-w-xs truncate" title={ep.dramaTitle}>
                              {ep.dramaTitle || `Drama ${dId}`}
                            </div>
                            <div className="text-[10px] text-slate-400 font-mono truncate">ID: {dId}</div>
                          </div>
                        </div>
                      </td>

                      {/* Column 2: Provider */}
                      <td className="px-4 py-3">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                            ep.provider === 'pinedrama'
                              ? 'bg-indigo-950 text-indigo-300 border border-indigo-800/60'
                              : 'bg-emerald-950 text-emerald-300 border border-emerald-800/60'
                          }`}
                        >
                          {ep.provider}
                        </span>
                      </td>

                      {/* Column 3: Episode # */}
                      <td className="px-4 py-3">
                        <div className="font-mono font-bold text-amber-400 text-xs">Ep {ep.episodeNumber}</div>
                        <div className="text-[10px] text-slate-400 truncate max-w-[120px]">{ep.title || `Episode ${ep.episodeNumber}`}</div>
                      </td>

                      {/* Column 4: GDrive Status (Ready / Mock / Pending) */}
                      <td className="px-4 py-3">
                        {isMock ? (
                          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-black bg-rose-500/20 text-rose-300 border border-rose-500/50 animate-pulse">
                            <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                            <span>⚠️ Mock Data</span>
                          </div>
                        ) : isReady ? (
                          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                            <span>☁️ Ready in Drive</span>
                          </div>
                        ) : (
                          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/30">
                            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                            <span>⏳ Pending Backup</span>
                          </div>
                        )}
                      </td>

                      {/* Column 5: File ID / Link */}
                      <td className="px-4 py-3 font-mono text-[11px]">
                        {isMock ? (
                          <div className="space-y-0.5">
                            <span className="text-rose-400 line-through truncate max-w-[150px] block" title={ep.gdriveFileId || ''}>
                              {ep.gdriveFileId}
                            </span>
                            <span className="text-[10px] text-rose-400/90 font-sans italic block">Perlu Force Resync</span>
                          </div>
                        ) : ep.gdriveFileId ? (
                          <div className="flex items-center gap-1.5">
                            <a
                              href={ep.gdriveDirectLink || ep.gdriveViewLink || `https://drive.google.com/file/d/${ep.gdriveFileId}/view`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-cyan-400 hover:underline flex items-center gap-1 max-w-[130px] sm:max-w-[170px] truncate"
                              title={ep.gdriveFileId}
                            >
                              <span>{ep.gdriveFileId}</span>
                              <ExternalLink className="w-3 h-3 shrink-0" />
                            </a>
                            <button
                              onClick={() => handleCopyLink(rowKey, ep.gdriveFileId || '')}
                              className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-white"
                              title="Salin File ID"
                            >
                              {copiedKey === rowKey ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                            </button>
                          </div>
                        ) : (
                          <span className="text-slate-500 italic">CDN ready, belum upload</span>
                        )}
                      </td>

                      {/* Column 6: Action Buttons */}
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {/* Force Resync Button */}
                          <button
                            onClick={() => handleSingleBackup(ep, true)}
                            disabled={isBackingUp || isMassSyncing}
                            className={`px-3 py-1.5 rounded-xl font-bold text-xs transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                              isMock
                                ? 'bg-gradient-to-r from-rose-600 to-amber-600 hover:from-rose-500 hover:to-amber-500 text-white shadow-md shadow-rose-600/30'
                                : isReady
                                ? 'bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700'
                                : 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 shadow-md shadow-emerald-500/20'
                            }`}
                            title="Unduh stream dari CDN dan simpan ke Google Drive"
                          >
                            {isBackingUp ? (
                              <>
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                <span>Uploading...</span>
                              </>
                            ) : (
                              <>
                                <RotateCcw className="w-3.5 h-3.5" />
                                <span>{isMock ? '🔄 Force Resync' : isReady ? 'Resync' : 'Upload'}</span>
                              </>
                            )}
                          </button>

                          {/* Preview GDrive Video */}
                          {isReady && ep.gdriveDirectLink && (
                            <button
                              onClick={() => setPreviewEp(ep)}
                              className="p-1.5 rounded-xl bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 text-xs font-bold transition-all cursor-pointer"
                              title="Preview Google Drive Stream"
                            >
                              <Play className="w-3.5 h-3.5 fill-cyan-300" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* GDrive Video Preview Modal */}
      {previewEp && (
        <div className="fixed inset-0 z-50 bg-slate-950/90 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-lg w-full p-6 space-y-4 shadow-2xl relative">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2 text-cyan-400 font-bold text-sm">
                <Cloud className="w-4 h-4" />
                <span>Google Drive Direct Stream Player</span>
              </div>
              <button
                onClick={() => setPreviewEp(null)}
                className="p-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-1">
              <h3 className="font-bold text-white text-base">{previewEp.dramaTitle}</h3>
              <p className="text-xs text-amber-400 font-semibold">
                Episode {previewEp.episodeNumber}: {previewEp.title}
              </p>
            </div>

            {/* Video Player Box */}
            <div className="relative aspect-[9/16] max-h-[460px] bg-slate-950 rounded-2xl overflow-hidden border border-slate-800 mx-auto">
              <video
                src={previewEp.gdriveDirectLink || previewEp.streamUrl || undefined}
                controls
                autoPlay
                controlsList="nodownload"
                className="w-full h-full object-contain"
              />
            </div>

            <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 text-xs text-slate-400 font-mono space-y-1">
              <div className="text-slate-300 font-bold flex items-center gap-1">
                <HardDrive className="w-3.5 h-3.5 text-cyan-400" />
                <span>Google Drive File ID: {previewEp.gdriveFileId}</span>
              </div>
              <div className="truncate text-[10px] text-cyan-400">{previewEp.gdriveDirectLink}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
