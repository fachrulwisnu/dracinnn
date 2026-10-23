import React, { useState, useEffect, useRef } from 'react';
import Hls from 'hls.js';
import {
  X,
  Play,
  RefreshCw,
  Zap,
  CheckCircle2,
  Clock,
  Film,
  Video,
  Copy,
  Check,
  AlertCircle,
  Loader2,
  Trash2,
  Edit3,
  Bot,
  ExternalLink,
  ShieldCheck,
  Flame,
} from 'lucide-react';
import { resolveCoverUrl, handleImageError } from '../utils/imageUtils';
import { useTerminal } from '../context/TerminalContext';

interface EpisodeItem {
  episodeNumber: number;
  title?: string;
  video_id?: string | null;
  vid?: string | null;
  duration?: number;
  episodeCover?: string;
  streamUrl?: string | null;
  bestUrl?: string | null;
  gdriveFileId?: string | null;
  gdriveViewLink?: string | null;
  gdriveDirectLink?: string | null;
  quality?: string | null;
  qualities?: any[];
  backupUrls?: string[];
  syncStatus: 'PENDING' | 'SYNCED' | 'FAILED' | 'BACKED_UP_GDRIVE' | string;
  errorMessage?: string | null;
  lastSyncedAt?: string;
}

interface DramaDetail {
  provider?: string;
  dramaId: string;
  collection_id?: string;
  book_id?: string;
  title: string;
  coverUrl: string;
  synopsis?: string;
  categories?: string[];
  totalEpisodes: number;
  syncedEpisodesCount: number;
  pendingEpisodesCount: number;
  syncStatus?: string;
}

interface EpisodeInspectorModalProps {
  drama: DramaDetail | null;
  initialEpisodes: EpisodeItem[];
  onClose: () => void;
  onRefreshData: () => void;
}

export const EpisodeInspectorModal: React.FC<EpisodeInspectorModalProps> = ({
  drama,
  initialEpisodes,
  onClose,
  onRefreshData,
}) => {
  const { addLog } = useTerminal();
  const [episodes, setEpisodes] = useState<EpisodeItem[]>(initialEpisodes || []);
  const [activeTab, setActiveTab] = useState<'table' | 'player'>('table');

  // Active playing episode
  const [playingEpNum, setPlayingEpNum] = useState<number | null>(null);
  const [activeStreamUrl, setActiveStreamUrl] = useState<string | null>(null);
  const [activeQuality, setActiveQuality] = useState<string>('720p');
  const [activeVideoId, setActiveVideoId] = useState<string | null>(null);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [isLoadingPlayer, setIsLoadingPlayer] = useState<boolean>(false);
  const [playerLoadingText, setPlayerLoadingText] = useState<string>('Loading stream...');

  // Single Episode Syncing state
  const [syncingEpNum, setSyncingEpNum] = useState<number | null>(null);

  // Mass Sync Loop state
  const [isMassSyncing, setIsMassSyncing] = useState<boolean>(false);
  const [massSyncProgress, setMassSyncProgress] = useState<{ current: number; total: number; epNum: number; title: string }>({
    current: 0,
    total: 0,
    epNum: 0,
    title: '',
  });
  const [massSyncSpeed, setMassSyncSpeed] = useState<'SAFE' | 'FAST'>('SAFE');
  const [massSyncCountdown, setMassSyncCountdown] = useState<number>(0);
  const [cooldownCountdown, setCooldownCountdown] = useState<number>(0);

  // Edit / Reset Episode Inline state
  const [editingEpNum, setEditingEpNum] = useState<number | null>(null);
  const [editStreamInput, setEditStreamInput] = useState<string>('');
  const [editVidInput, setEditVidInput] = useState<string>('');

  const [copiedUrl, setCopiedUrl] = useState<boolean>(false);

  const massSyncActiveRef = useRef<boolean>(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);

  if (!drama) return null;

  const provider = (drama.provider || 'pinedrama') === 'melolo' ? 'melolo' : 'pinedrama';
  const targetCollectionId = drama.book_id || drama.collection_id || (drama as any).series_id_str || drama.dramaId || (drama as any)._id || (drama as any).id;

  // Refresh episodes from DB
  const refreshEpisodesFromDb = async () => {
    try {
      const res = await fetch(`/api/dramas/${provider}/${targetCollectionId}/episodes`);
      const data = await res.json();
      if (data.success && Array.isArray(data.episodes)) {
        setEpisodes(data.episodes);
      }
    } catch (err) {
      console.error('Error refreshing episode list:', err);
    }
  };

  useEffect(() => {
    refreshEpisodesFromDb();
  }, [drama.dramaId, provider]);

  // Handle Single Episode Sync (Fetch direct from browser and save)
  const handleSingleEpisodeSync = async (epNum: number) => {
    setSyncingEpNum(epNum);
    try {
      const ep = episodes.find((e) => e.episodeNumber === epNum);
      let vid = ep?.video_id || ep?.vid || null;

      let fetchUrl = '';

      if (provider === 'melolo') {
        // Melolo Pipeline: Ensure vid exists
        if (!vid) {
          try {
            const detailRes = await fetch(`https://api.sansekai.my.id/api/melolo/detail?book_id=${targetCollectionId}&lang=id`, {
              headers: { Accept: '*/*' },
              referrerPolicy: 'no-referrer',
            });
            if (detailRes.ok) {
              const detailJson = await detailRes.json();
              await fetch('/api/dramas/update-melolo-detail', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ collection_id: targetCollectionId, rawDetail: detailJson }),
              });
              // Refresh episodes to retrieve resolved vid
              const freshRes = await fetch(`/api/dramas/${provider}/${targetCollectionId}/episodes`);
              const freshData = await freshRes.json();
              if (freshData.episodes) {
                setEpisodes(freshData.episodes);
                const updatedEp = freshData.episodes.find((e: any) => e.episodeNumber === epNum);
                vid = updatedEp?.video_id || updatedEp?.vid || null;
              }
            }
          } catch (e) {}
        }

        if (vid) {
          fetchUrl = `https://api.sansekai.my.id/api/melolo/get-episode?videoId=${vid}`;
        } else {
          alert(`Gagal menemukan video_id (vid) untuk Melolo Episode ${epNum}.`);
          setSyncingEpNum(null);
          return;
        }
      } else {
        // PineDrama Pipeline
        fetchUrl = `https://api.sansekai.my.id/api/pinedrama/get-episode?collection_id=${targetCollectionId}&episodeNumber=${epNum}&lang=id`;
      }

      const streamRes = await fetch(fetchUrl, {
        method: 'GET',
        headers: { Accept: '*/*' },
        referrerPolicy: 'no-referrer',
        credentials: 'omit',
      });

      if (streamRes.status === 429) {
        alert('⚠ HTTP 429 Rate Limit hit. Mohon tunggu 30 detik.');
        setSyncingEpNum(null);
        return;
      }

      if (streamRes.ok) {
        const jsonPayload = await streamRes.json();
        const saveRes = await fetch('/api/sync/save-episode', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            provider,
            collection_id: targetCollectionId,
            episodeNumber: epNum,
            video_id: vid,
            rawResponse: jsonPayload,
          }),
        });

        const saveData = await saveRes.json();
        if (saveData.success) {
          await refreshEpisodesFromDb();
          onRefreshData();
        } else {
          alert(`Gagal menyimpan: ${saveData.error}`);
        }
      } else {
        alert(`HTTP ${streamRes.status} saat fetch episode.`);
      }
    } catch (err: any) {
      alert(`Error sync episode: ${err.message}`);
    } finally {
      setSyncingEpNum(null);
    }
  };

  // Handle Mass Sync Loop (Loop through all pending episodes for this drama)
  const handleStartMassSync = async () => {
    if (massSyncActiveRef.current) return;

    const pendingEps = episodes.filter((e) => e.syncStatus !== 'SYNCED');
    if (pendingEps.length === 0) {
      alert('Semua episode untuk drama ini sudah berstatus SYNCED!');
      return;
    }

    massSyncActiveRef.current = true;
    setIsMassSyncing(true);

    const slotDelayMs = massSyncSpeed === 'SAFE' ? 12500 : 6500;
    const totalToSync = pendingEps.length;

    try {
      for (let i = 0; i < pendingEps.length; i++) {
        if (!massSyncActiveRef.current) break;

        const ep = pendingEps[i];
        const epNum = ep.episodeNumber;

        setMassSyncProgress({
          current: i + 1,
          total: totalToSync,
          epNum,
          title: ep.title || `Episode ${epNum}`,
        });

        await handleSingleEpisodeSync(epNum);

        // Countdown for delay slot
        for (let sec = Math.ceil(slotDelayMs / 1000); sec > 0; sec--) {
          if (!massSyncActiveRef.current) break;
          setMassSyncCountdown(sec);
          await new Promise((r) => setTimeout(r, 1000));
        }
        setMassSyncCountdown(0);
      }

      alert('🎉 Selesai melakukan Mass Sync seluruh episode!');
    } catch (err: any) {
      console.error('Error in mass sync:', err);
    } finally {
      massSyncActiveRef.current = false;
      setIsMassSyncing(false);
      await refreshEpisodesFromDb();
      onRefreshData();
    }
  };

  const handleStopMassSync = () => {
    massSyncActiveRef.current = false;
    setIsMassSyncing(false);
  };

  // Play Episode On-Demand with GDrive Priority
  const handlePlayEpisode = async (epNum: number) => {
    setPlayingEpNum(epNum);
    setActiveTab('player');
    setPlayerError(null);

    const ep = episodes.find((e) => e.episodeNumber === epNum);

    // 1. Prioritize Google Drive Direct Link if available (anti-expired!)
    if (ep && ep.gdriveDirectLink) {
      setActiveStreamUrl(ep.gdriveDirectLink);
      setActiveQuality('☁️ Google Drive Direct');
      setActiveVideoId(ep.video_id || ep.vid || null);
      return;
    }

    // 2. If already synced CDN stream exists, play CDN stream AND auto-trigger background GDrive backup
    if (ep && (ep.syncStatus === 'SYNCED' || ep.syncStatus === 'BACKED_UP_GDRIVE') && (ep.bestUrl || ep.streamUrl)) {
      const cdnUrl = ep.bestUrl || ep.streamUrl || '';
      setActiveStreamUrl(cdnUrl);
      setActiveQuality(ep.quality || '720p CDN');
      setActiveVideoId(ep.video_id || ep.vid || null);

      // Auto-trigger background GDrive backup if not backed up yet
      if (!ep.gdriveFileId) {
        addLog('info', `[Auto GDrive] Menjalankan background backup untuk "${drama.title}" Ep ${epNum}...`);
        fetch('/api/drive/auto-backup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            dramaId: targetCollectionId,
            provider,
            episodeNumber: epNum,
            streamUrl: cdnUrl,
            dramaTitle: drama.title,
          }),
        })
          .then((r) => r.json())
          .then((data) => {
            if (data.success) {
              addLog('success', `[Auto GDrive] Berhasil backup "${drama.title}" Ep ${epNum} ke Google Drive! File ID: ${data.data?.fileId || 'OK'}`);
              refreshEpisodesFromDb();
            } else {
              addLog('error', `[Auto GDrive] Gagal backup "${drama.title}" Ep ${epNum}: ${data.error}`, data.details);
            }
          })
          .catch((err) => {
            console.warn('[Auto GDrive Backup error]:', err);
            addLog('error', `[Auto GDrive] Network error: ${err.message}`, err.stack);
          });
      }
      return;
    }

    // On-Demand fetch required from Sansekai
    setIsLoadingPlayer(true);

    try {
      let vid = ep?.video_id || ep?.vid || null;

      if (provider === 'melolo') {
        setPlayerLoadingText(`On-Demand Syncing Melolo Ep ${epNum}...`);

        if (!vid) {
          setPlayerLoadingText(`Fetching Melolo detail to resolve vid for Ep ${epNum}...`);
          const detailRes = await fetch(`https://api.sansekai.my.id/api/melolo/detail?book_id=${targetCollectionId}&lang=id`, {
            headers: { Accept: '*/*' },
            referrerPolicy: 'no-referrer',
          });

          if (detailRes.ok) {
            const detailJson = await detailRes.json();
            await fetch('/api/dramas/update-melolo-detail', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ collection_id: targetCollectionId, rawDetail: detailJson }),
            });

            // Re-fetch episodes
            const freshRes = await fetch(`/api/dramas/${provider}/${targetCollectionId}/episodes`);
            const freshData = await freshRes.json();
            if (freshData.episodes) {
              setEpisodes(freshData.episodes);
              const matched = freshData.episodes.find((e: any) => e.episodeNumber === epNum);
              vid = matched?.video_id || matched?.vid || null;
            }
          }
        }

        if (!vid) {
          throw new Error(`Tidak dapat menemukan video_id (vid) untuk Melolo Episode ${epNum}.`);
        }

        setPlayerLoadingText(`Fetching direct Melolo stream for videoId: ${vid}...`);
        const streamUrl = `https://api.sansekai.my.id/api/melolo/get-episode?videoId=${vid}`;
        const streamRes = await fetch(streamUrl, {
          headers: { Accept: '*/*' },
          referrerPolicy: 'no-referrer',
        });

        if (!streamRes.ok) {
          throw new Error(`HTTP ${streamRes.status} fetching Melolo episode stream.`);
        }

        const jsonPayload = await streamRes.json();
        const best = jsonPayload.streamUrl || jsonPayload.qualities?.[0]?.streamUrl;

        if (!best) {
          throw new Error('Link stream URL tidak ditemukan dalam respons Melolo.');
        }

        // Save to DB
        await fetch('/api/sync/save-episode', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            provider: 'melolo',
            collection_id: targetCollectionId,
            episodeNumber: epNum,
            video_id: vid,
            rawResponse: jsonPayload,
          }),
        });

        setActiveStreamUrl(best);
        setActiveQuality(jsonPayload.definition || '720p');
        setActiveVideoId(vid);
        refreshEpisodesFromDb();
        onRefreshData();

        // Trigger background GDrive backup
        fetch('/api/drive/auto-backup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            dramaId: targetCollectionId,
            provider: 'melolo',
            episodeNumber: epNum,
            streamUrl: best,
            dramaTitle: drama.title,
          }),
        })
          .then((r) => r.json())
          .then((data) => {
            if (data.success) refreshEpisodesFromDb();
          })
          .catch((err) => console.warn('[Auto GDrive Backup error]:', err));
      } else {
        // PineDrama Pipeline
        setPlayerLoadingText(`On-Demand Syncing PineDrama Ep ${epNum}...`);
        const streamUrl = `https://api.sansekai.my.id/api/pinedrama/get-episode?collection_id=${targetCollectionId}&episodeNumber=${epNum}&lang=id`;
        const streamRes = await fetch(streamUrl, {
          headers: { Accept: '*/*' },
          referrerPolicy: 'no-referrer',
        });

        if (!streamRes.ok) {
          throw new Error(`HTTP ${streamRes.status} fetching PineDrama episode stream.`);
        }

        const jsonPayload = await streamRes.json();
        const best = jsonPayload.best_url || jsonPayload.streamUrl || jsonPayload.main?.indo_cdn_urls?.[0];

        if (!best) {
          throw new Error('Link stream URL tidak ditemukan dalam respons PineDrama.');
        }

        await fetch('/api/sync/save-episode', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            provider: 'pinedrama',
            collection_id: targetCollectionId,
            episodeNumber: epNum,
            video_id: vid,
            rawResponse: jsonPayload,
          }),
        });

        setActiveStreamUrl(best);
        setActiveQuality(jsonPayload.quality || 'HD_INDO');
        setActiveVideoId(vid);
        refreshEpisodesFromDb();
        onRefreshData();

        // Trigger background GDrive backup
        fetch('/api/drive/auto-backup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            dramaId: targetCollectionId,
            provider: 'pinedrama',
            episodeNumber: epNum,
            streamUrl: best,
            dramaTitle: drama.title,
          }),
        })
          .then((r) => r.json())
          .then((data) => {
            if (data.success) refreshEpisodesFromDb();
          })
          .catch((err) => console.warn('[Auto GDrive Backup error]:', err));
      }
    } catch (err: any) {
      setPlayerError(err.message || 'Gagal memutar video episode.');
    } finally {
      setIsLoadingPlayer(false);
    }
  };

  // Video Element setup for HLS / MP4
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !activeStreamUrl) return;

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    const isHlsUrl = activeStreamUrl.includes('.m3u8');

    if (isHlsUrl && Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true });
      hlsRef.current = hls;
      hls.loadSource(activeStreamUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch(() => {});
      });
    } else {
      video.src = activeStreamUrl;
      video.play().catch(() => {});
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [activeStreamUrl]);

  // Edit Episode Manual Submit
  const handleSaveEpisodeManual = async (epNum: number) => {
    try {
      const res = await fetch(`/api/episodes/${provider}/${targetCollectionId}/${epNum}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          streamUrl: editStreamInput,
          video_id: editVidInput,
        }),
      });
      const data = await res.json();
      if (data.success) {
        alert(`Episode ${epNum} berhasil diperbarui!`);
        setEditingEpNum(null);
        refreshEpisodesFromDb();
        onRefreshData();
      } else {
        alert(`Gagal: ${data.error}`);
      }
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    }
  };

  // Reset Episode Stream
  const handleResetEpisodeStream = async (epNum: number) => {
    if (!confirm(`Reset stream link Episode ${epNum} kembali ke status PENDING?`)) return;
    try {
      const res = await fetch(`/api/episodes/${provider}/${targetCollectionId}/${epNum}/reset`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (data.success) {
        refreshEpisodesFromDb();
        onRefreshData();
      } else {
        alert(`Gagal reset: ${data.error}`);
      }
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    }
  };

  const syncedCount = episodes.filter((e) => e.syncStatus === 'SYNCED').length;
  const totalEps = drama.totalEpisodes || episodes.length;
  const syncedPercent = totalEps > 0 ? Math.round((syncedCount / totalEps) * 100) : 0;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/90 backdrop-blur-xl flex items-center justify-center p-3 sm:p-6 overflow-y-auto">
      <div className="relative w-full max-w-6xl bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-2xl flex flex-col max-h-[92vh]">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-20 p-2.5 rounded-full bg-slate-950/80 text-slate-300 hover:text-white hover:bg-rose-600 transition-all cursor-pointer border border-slate-800"
        >
          <X className="w-5 h-5" />
        </button>

        {/* 1. Header Information Banner */}
        <div className="bg-slate-950 p-6 border-b border-slate-800 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <img
              src={resolveCoverUrl(drama.coverUrl)}
              alt={drama.title}
              className="w-16 h-24 object-cover rounded-2xl bg-slate-900 border border-slate-800 shrink-0"
              referrerPolicy="no-referrer"
              onError={(e) => handleImageError(e, drama.coverUrl)}
            />
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span
                  className={`px-2.5 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider border ${
                    provider === 'melolo'
                      ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
                      : 'bg-indigo-950 text-indigo-300 border-indigo-800'
                  }`}
                >
                  {provider === 'melolo' ? '🍈 MELOLO' : '🌲 PINEDRAMA'}
                </span>
                <span className="text-xs font-mono text-slate-400">ID: {targetCollectionId}</span>
              </div>

              <h2 className="text-2xl font-black text-white">{drama.title}</h2>
              <div className="text-xs text-slate-400 font-semibold flex items-center gap-2">
                <span>{drama.categories?.join(', ') || 'General'}</span>
                <span>·</span>
                <span className="text-emerald-400 font-mono">
                  Ready: {syncedCount} / {totalEps} Synced ({syncedPercent}%)
                </span>
              </div>
            </div>
          </div>

          {/* Tab Switcher & Mass Sync Bar */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="bg-slate-900 p-1 rounded-xl border border-slate-800 flex items-center gap-1">
              <button
                onClick={() => setActiveTab('table')}
                className={`px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  activeTab === 'table'
                    ? 'bg-amber-500 text-slate-950 shadow-md'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                📋 Table &amp; Granular Sync
              </button>
              <button
                onClick={() => setActiveTab('player')}
                className={`px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  activeTab === 'player'
                    ? 'bg-amber-500 text-slate-950 shadow-md'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                🎬 Video Player
              </button>
            </div>

            {/* Mass Sync Button */}
            {!isMassSyncing ? (
              <button
                onClick={handleStartMassSync}
                className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-black text-xs transition-all shadow-lg shadow-emerald-600/20 cursor-pointer flex items-center gap-2"
              >
                <Bot className="w-4 h-4" />
                <span>🚀 Sync Masal Semua Episode ({totalEps - syncedCount} Pending)</span>
              </button>
            ) : (
              <button
                onClick={handleStopMassSync}
                className="px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs transition-all cursor-pointer flex items-center gap-2"
              >
                <X className="w-4 h-4" />
                <span>Stop Mass Sync</span>
              </button>
            )}
          </div>
        </div>

        {/* Mass Sync Live Progress Bar Banner */}
        {isMassSyncing && (
          <div className="bg-gradient-to-r from-slate-950 via-amber-950/40 to-slate-950 p-4 border-b border-amber-500/30 space-y-2">
            <div className="flex items-center justify-between text-xs font-bold">
              <span className="text-amber-300 flex items-center gap-2">
                <Loader2 className="w-4 h-4 text-amber-400 animate-spin" />
                Mass Syncing Episode {massSyncProgress.current} of {massSyncProgress.total}: "{massSyncProgress.title}"...
              </span>
              <span className="font-mono text-emerald-400">
                {Math.round((massSyncProgress.current / massSyncProgress.total) * 100)}%
              </span>
            </div>
            <div className="w-full bg-slate-900 h-2.5 rounded-full overflow-hidden border border-slate-800">
              <div
                className="bg-gradient-to-r from-amber-500 to-emerald-400 h-full transition-all duration-300"
                style={{ width: `${(massSyncProgress.current / massSyncProgress.total) * 100}%` }}
              />
            </div>
            {massSyncCountdown > 0 && (
              <div className="text-[11px] font-mono text-slate-400 text-right">
                Next episode slot in {massSyncCountdown}s...
              </div>
            )}
          </div>
        )}

        {/* 2. Main Content Area */}
        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          {activeTab === 'table' ? (
            /* TAB 1: Granular Episode Table */
            <div className="space-y-4">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span className="font-bold text-white">Daftar Episode ({episodes.length} Dokumen di Database)</span>
                <span className="font-mono text-emerald-400 font-semibold">{syncedCount} Synced / {totalEps - syncedCount} Pending</span>
              </div>

              <div className="overflow-x-auto bg-slate-950 rounded-2xl border border-slate-800">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 font-semibold uppercase tracking-wider bg-slate-900/60">
                      <th className="py-3 px-4 w-16">Ep #</th>
                      <th className="py-3 px-4">Judul &amp; Video ID</th>
                      <th className="py-3 px-4">Durasi</th>
                      <th className="py-3 px-4">Status Sync</th>
                      <th className="py-3 px-4">Stream Link Preview</th>
                      <th className="py-3 px-4 text-right">CRUD / Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 text-slate-300">
                    {episodes.map((ep) => {
                      const isSynced = ep.syncStatus === 'SYNCED' && (ep.bestUrl || ep.streamUrl);
                      const isEditing = editingEpNum === ep.episodeNumber;

                      return (
                        <tr key={ep.episodeNumber} className="hover:bg-slate-900/50 transition-colors">
                          <td className="py-3 px-4 font-mono font-bold text-amber-400">
                            Ep {ep.episodeNumber}
                          </td>

                          <td className="py-3 px-4 font-medium text-white max-w-xs">
                            <div className="truncate font-semibold">{ep.title || `Episode ${ep.episodeNumber}`}</div>
                            {(ep.video_id || ep.vid) && (
                              <div className="text-[10px] text-slate-500 font-mono">vid: {ep.video_id || ep.vid}</div>
                            )}
                          </td>

                          <td className="py-3 px-4 font-mono text-slate-400">
                            {ep.duration ? `${Math.round(ep.duration)}s` : '-'}
                          </td>

                          <td className="py-3 px-4">
                            {isSynced ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-800">
                                🟢 SYNCED
                              </span>
                            ) : (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-amber-950 text-amber-300 border border-amber-800">
                                🟡 PENDING
                              </span>
                            )}
                          </td>

                          <td className="py-3 px-4 font-mono text-[11px] text-slate-400 max-w-xs truncate">
                            {ep.bestUrl || ep.streamUrl ? (
                              <span className="text-emerald-400 truncate block">
                                {(ep.bestUrl || ep.streamUrl || '').slice(0, 45)}...
                              </span>
                            ) : (
                              <span className="text-slate-600 italic">Belum disinkronkan</span>
                            )}
                          </td>

                          <td className="py-3 px-4 text-right space-x-1.5 whitespace-nowrap">
                            {/* Sync / Refresh Button */}
                            <button
                              onClick={() => handleSingleEpisodeSync(ep.episodeNumber)}
                              disabled={syncingEpNum === ep.episodeNumber || isMassSyncing}
                              className="px-2.5 py-1.5 rounded-lg bg-emerald-600/20 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-600 hover:text-white font-bold transition-all cursor-pointer disabled:opacity-50 inline-flex items-center gap-1"
                            >
                              <RefreshCw className={`w-3 h-3 ${syncingEpNum === ep.episodeNumber ? 'animate-spin' : ''}`} />
                              <span>Sync</span>
                            </button>

                            {/* Play / Preview Button */}
                            <button
                              onClick={() => handlePlayEpisode(ep.episodeNumber)}
                              className="px-2.5 py-1.5 rounded-lg bg-amber-500 text-slate-950 font-bold hover:bg-amber-400 transition-colors cursor-pointer inline-flex items-center gap-1"
                            >
                              <Play className="w-3 h-3 fill-current" />
                              <span>Play</span>
                            </button>

                            {/* Reset Button */}
                            {isSynced && (
                              <button
                                onClick={() => handleResetEpisodeStream(ep.episodeNumber)}
                                className="px-2 py-1.5 rounded-lg bg-rose-950/60 text-rose-300 border border-rose-800 hover:bg-rose-600 hover:text-white font-bold transition-colors cursor-pointer"
                                title="Reset Stream Link"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            /* TAB 2: Video Player Frame */
            <div className="flex flex-col lg:flex-row items-center justify-center gap-8 bg-slate-950 p-6 rounded-2xl border border-slate-800">
              <div className="relative w-full max-w-[300px] aspect-[9/16] bg-black rounded-3xl overflow-hidden border-4 border-slate-800 shadow-2xl flex items-center justify-center">
                {isLoadingPlayer ? (
                  <div className="flex flex-col items-center gap-3 p-6 text-center text-amber-300">
                    <Loader2 className="w-10 h-10 animate-spin text-amber-400" />
                    <div className="text-xs font-bold">{playerLoadingText}</div>
                  </div>
                ) : playerError ? (
                  <div className="flex flex-col items-center gap-3 p-6 text-center text-rose-300">
                    <AlertCircle className="w-10 h-10 text-rose-400" />
                    <div className="text-xs font-semibold">{playerError}</div>
                  </div>
                ) : activeStreamUrl ? (
                  <video
                    ref={videoRef}
                    controls
                    playsInline
                    {...({ referrerPolicy: 'no-referrer' } as any)}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="text-xs text-slate-500 italic">Pilih episode dari tabel di samping</div>
                )}
              </div>

              <div className="space-y-4 max-w-md">
                <div>
                  <div className="text-xs font-bold text-amber-400 uppercase tracking-wider">
                    Playing Episode {playingEpNum || 1}
                  </div>
                  <h3 className="text-xl font-bold text-white mt-1">{drama.title}</h3>
                  <p className="text-xs text-slate-400 mt-1">{drama.synopsis || 'Tidak ada deskripsi'}</p>
                </div>

                {activeStreamUrl && (
                  <div className="bg-slate-900 p-4 rounded-xl border border-slate-800 space-y-2 text-xs font-mono">
                    <div className="text-slate-400 font-bold">Stream URL:</div>
                    <div className="text-emerald-400 truncate bg-slate-950 p-2 rounded border border-slate-800">
                      {activeStreamUrl}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
