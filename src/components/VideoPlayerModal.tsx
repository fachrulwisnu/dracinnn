import React, { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import {
  X,
  Play,
  Copy,
  Check,
  Zap,
  Film,
  Loader2,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  RefreshCw,
  Video,
} from 'lucide-react';
import { resolveCoverUrl, handleImageError } from '../utils/imageUtils';

interface EpisodeItem {
  episodeNumber: number;
  title?: string;
  bestUrl?: string | null;
  streamUrl?: string | null;
  video_id?: string | null;
  vid?: string | null;
  quality?: string | null;
  backupUrls?: string[];
  syncStatus: string;
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
}

interface VideoPlayerModalProps {
  drama: DramaDetail | null;
  episodes: EpisodeItem[];
  onClose: () => void;
  onFetchOnDemand: (dramaId: string, epNum: number) => Promise<any>;
}

export const VideoPlayerModal: React.FC<VideoPlayerModalProps> = ({
  drama,
  episodes: initialEpisodes,
  onClose,
  onFetchOnDemand,
}) => {
  const [episodes, setEpisodes] = useState<EpisodeItem[]>(initialEpisodes || []);
  const [currentEpisodeNum, setCurrentEpisodeNum] = useState<number>(1);
  const [activeMirrorIndex, setActiveMirrorIndex] = useState<number>(0);
  const [availableMirrors, setAvailableMirrors] = useState<string[]>([]);
  const [activeQuality, setActiveQuality] = useState<string>('720p');
  const [activeVideoId, setActiveVideoId] = useState<string | null>(null);

  const [isLoadingStream, setIsLoadingStream] = useState<boolean>(false);
  const [loadingText, setLoadingText] = useState<string>('Loading stream...');
  const [copiedUrl, setCopiedUrl] = useState<boolean>(false);
  const [playerError, setPlayerError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);

  if (!drama) return null;

  const provider = (drama.provider || 'pinedrama') === 'melolo' ? 'melolo' : 'pinedrama';
  const targetCollectionId = drama.book_id || drama.collection_id || (drama as any).series_id_str || drama.dramaId || (drama as any)._id || (drama as any).id;

  // Load stream for episode (Part 2 Fix)
  const loadEpisodeStream = async (epNum: number) => {
    setCurrentEpisodeNum(epNum);
    setPlayerError(null);
    setActiveMirrorIndex(0);

    const ep = episodes.find((e) => e.episodeNumber === epNum);

    // If already synced, play immediately!
    if (ep && ep.syncStatus === 'SYNCED' && (ep.bestUrl || ep.streamUrl)) {
      const best = ep.bestUrl || ep.streamUrl || '';
      const mirrors = Array.from(new Set([best, ...(ep.backupUrls || [])])).filter(Boolean);
      setAvailableMirrors(mirrors as string[]);
      setActiveQuality(ep.quality || '720p');
      setActiveVideoId(ep.video_id || ep.vid || null);
      return;
    }

    // On-Demand fetch required!
    setIsLoadingStream(true);

    try {
      if (provider === 'melolo') {
        // Melolo Pipeline 2-Step Fetch
        setLoadingText(`Mengambil detail Melolo...`);

        let vid = ep?.video_id || ep?.vid || null;

        // Step 1: If video_id is missing, fetch detail to resolve vid
        if (!vid) {
          setLoadingText(`Mengambil detail Melolo...`);
          let detailJson: any = null;
          const detailUrl = `https://api.sansekai.my.id/api/melolo/detail?book_id=${targetCollectionId}&lang=id`;
          try {
            const detailRes = await fetch(detailUrl, {
              headers: { Accept: '*/*' },
              referrerPolicy: 'no-referrer',
            });
            if (detailRes.ok) {
              detailJson = await detailRes.json();
            }
          } catch (e) {}

          if (!detailJson || typeof detailJson !== 'object') {
            try {
              const proxyRes = await fetch(`/api/proxy-sansekai?url=${encodeURIComponent(detailUrl)}`);
              if (proxyRes.ok) detailJson = await proxyRes.json();
            } catch (e) {}
          }

          if (detailJson) {
            await fetch('/api/dramas/update-melolo-detail', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ collection_id: targetCollectionId, rawDetail: detailJson }),
            });

            // Re-fetch episode list
            const freshRes = await fetch(`/api/dramas/melolo/${targetCollectionId}/episodes`);
            if (freshRes.ok) {
              const freshData = await freshRes.json();
              if (freshData.episodes) {
                setEpisodes(freshData.episodes);
                const matched = freshData.episodes.find((e: any) => e.episodeNumber === epNum);
                vid = matched?.video_id || matched?.vid || null;
              }
            }
          }
        }

        if (!vid) {
          throw new Error(`Tidak dapat menemukan video_id (vid) untuk Melolo Episode ${epNum}.`);
        }

        // Step 2: Fetch stream using videoId
        setLoadingText(`Mendekripsi Stream Video Melolo...`);
        let jsonPayload: any = null;
        const streamEndpoint = `https://api.sansekai.my.id/api/melolo/get-episode?videoId=${vid}`;
        try {
          const streamRes = await fetch(streamEndpoint, {
            headers: { Accept: '*/*' },
            referrerPolicy: 'no-referrer',
          });

          if (streamRes.ok) {
            jsonPayload = await streamRes.json();
          }
        } catch (e) {}

        if (!jsonPayload || typeof jsonPayload !== 'object') {
          try {
            const proxyRes = await fetch(`/api/proxy-sansekai?url=${encodeURIComponent(streamEndpoint)}`);
            if (proxyRes.ok) jsonPayload = await proxyRes.json();
          } catch (e) {}
        }

        const best = jsonPayload?.streamUrl || jsonPayload?.qualities?.[0]?.streamUrl;

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
            book_id: targetCollectionId,
            episodeNumber: epNum,
            video_id: vid,
            rawResponse: jsonPayload,
            streamUrl: best,
          }),
        });

        const mirrors = Array.from(
          new Set([best, ...(jsonPayload.qualities || []).map((q: any) => q.streamUrl)])
        ).filter(Boolean) as string[];

        setAvailableMirrors(mirrors);
        setActiveQuality(jsonPayload.definition || '720p');
        setActiveVideoId(vid);
      } else {
        // PineDrama Pipeline
        setLoadingText(`On-Demand Syncing PineDrama Ep ${epNum}...`);
        const streamUrl = `https://api.sansekai.my.id/api/pinedrama/get-episode?collection_id=${targetCollectionId}&episodeNumber=${epNum}&lang=id`;
        const streamRes = await fetch(streamUrl, {
          headers: { Accept: '*/*' },
          referrerPolicy: 'no-referrer',
        });

        if (!streamRes.ok) {
          throw new Error(`HTTP ${streamRes.status} fetching PineDrama stream.`);
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
            video_id: ep?.video_id,
            rawResponse: jsonPayload,
          }),
        });

        const mirrors = Array.from(
          new Set([
            best,
            ...(jsonPayload.backup_urls || []),
            ...(jsonPayload.alt?.indo_hd_cdn_urls || []),
            ...(jsonPayload.main?.indo_cdn_urls || []),
          ])
        ).filter(Boolean) as string[];

        setAvailableMirrors(mirrors);
        setActiveQuality(jsonPayload.quality || 'HD_INDO');
        setActiveVideoId(ep?.video_id || null);
      }
    } catch (err: any) {
      setPlayerError(err.message || 'Gagal memutar video episode.');
    } finally {
      setIsLoadingStream(false);
    }
  };

  // Auto load episode on mount
  useEffect(() => {
    if (episodes.length > 0) {
      const firstSynced = episodes.find((e) => e.syncStatus === 'SYNCED') || episodes[0];
      loadEpisodeStream(firstSynced.episodeNumber);
    }
  }, [drama.dramaId]);

  const currentActiveUrl = availableMirrors[activeMirrorIndex] || null;

  // Video element setup
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !currentActiveUrl) return;

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    const isHlsUrl = currentActiveUrl.includes('.m3u8');

    if (isHlsUrl && Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true, lowLatencyMode: true });
      hlsRef.current = hls;
      hls.loadSource(currentActiveUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch(() => {});
      });
    } else {
      video.src = currentActiveUrl;
      video.play().catch(() => {});
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [currentActiveUrl]);

  const handleVideoError = () => {
    if (availableMirrors.length > 1 && activeMirrorIndex < availableMirrors.length - 1) {
      setActiveMirrorIndex((prev) => prev + 1);
    } else {
      setPlayerError('Stream error on all mirror URLs.');
    }
  };

  const copyStreamUrlToClipboard = () => {
    if (!currentActiveUrl) return;
    navigator.clipboard.writeText(currentActiveUrl);
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/90 backdrop-blur-xl flex items-center justify-center p-2 sm:p-4 md:p-6 overflow-y-auto">
      <div className="relative w-full max-w-5xl bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-2xl flex flex-col lg:flex-row max-h-[90vh]">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-20 p-2.5 rounded-full bg-slate-950/80 text-slate-300 hover:text-white hover:bg-rose-600 transition-all cursor-pointer border border-slate-800"
        >
          <X className="w-5 h-5" />
        </button>

        {/* LEFT COLUMN: 9:16 Vertical Video Player Container */}
        <div className="w-full lg:w-1/2 bg-slate-950 p-4 sm:p-6 flex flex-col items-center justify-center border-b lg:border-b-0 lg:border-r border-slate-800">
          <div className="relative w-full max-w-[320px] aspect-[9/16] bg-black rounded-3xl overflow-hidden shadow-2xl border-4 border-slate-800 flex items-center justify-center">
            {isLoadingStream ? (
              <div className="flex flex-col items-center gap-3 p-6 text-center">
                <Loader2 className="w-10 h-10 text-amber-400 animate-spin" />
                <div className="text-sm font-bold text-amber-300">{loadingText}</div>
              </div>
            ) : playerError ? (
              <div className="flex flex-col items-center gap-3 p-6 text-center text-rose-300">
                <AlertCircle className="w-10 h-10 text-rose-400" />
                <div className="text-xs font-semibold">{playerError}</div>
              </div>
            ) : currentActiveUrl ? (
              <video
                ref={videoRef}
                controls
                playsInline
                {...({ referrerPolicy: 'no-referrer' } as any)}
                onError={handleVideoError}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="text-xs text-slate-500 italic">Select an episode to play</div>
            )}

            {/* Quality & Video ID Badges */}
            {currentActiveUrl && !isLoadingStream && (
              <div className="absolute top-3 left-3 flex flex-col gap-1 items-start pointer-events-none">
                <span className="px-2 py-0.5 rounded-md bg-slate-950/80 text-amber-400 border border-amber-500/30 text-[10px] font-mono font-bold backdrop-blur-md">
                  {activeQuality || '720p'}
                </span>
                {activeVideoId && (
                  <span className="px-2 py-0.5 rounded-md bg-slate-950/80 text-slate-300 border border-slate-700/50 text-[9px] font-mono backdrop-blur-md">
                    ID: {activeVideoId}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Episode Prev / Next Bar */}
          <div className="w-full max-w-[320px] mt-4 flex items-center justify-between text-xs text-slate-400">
            <button
              onClick={() => loadEpisodeStream(Math.max(1, currentEpisodeNum - 1))}
              disabled={currentEpisodeNum <= 1 || isLoadingStream}
              className="flex items-center gap-1 hover:text-white disabled:opacity-30 cursor-pointer font-bold"
            >
              <ChevronLeft className="w-4 h-4" /> Prev
            </button>
            <span className="font-mono text-amber-400 font-bold">
              Ep {currentEpisodeNum} / {drama.totalEpisodes}
            </span>
            <button
              onClick={() => loadEpisodeStream(Math.min(drama.totalEpisodes, currentEpisodeNum + 1))}
              disabled={currentEpisodeNum >= drama.totalEpisodes || isLoadingStream}
              className="flex items-center gap-1 hover:text-white disabled:opacity-30 cursor-pointer font-bold"
            >
              Next <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* RIGHT COLUMN: Mirrors & Episode Grid */}
        <div className="w-full lg:w-1/2 p-6 flex flex-col justify-between overflow-y-auto space-y-6">
          <div className="space-y-4">
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-amber-400 flex items-center gap-2">
                <Video className="w-4 h-4" />
                <span>[{provider.toUpperCase()}] Streaming Player · {activeQuality}</span>
              </div>
              <h2 className="text-2xl font-black text-white mt-1">{drama.title}</h2>
              <div className="text-xs text-slate-400 mt-1 flex items-center gap-2">
                <span>{drama.categories?.join(', ') || 'General'}</span>
                <span>·</span>
                <span>{drama.syncedEpisodesCount} Ready / {drama.pendingEpisodesCount} Pending</span>
              </div>
            </div>

            {/* Mirror Selector */}
            {availableMirrors.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs font-bold text-slate-300">CDN Mirrors ({availableMirrors.length})</div>
                <div className="flex items-center gap-2 overflow-x-auto pb-1">
                  {availableMirrors.map((url, idx) => (
                    <button
                      key={idx}
                      onClick={() => {
                        setActiveMirrorIndex(idx);
                        setPlayerError(null);
                      }}
                      className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition-all cursor-pointer whitespace-nowrap ${
                        activeMirrorIndex === idx
                          ? 'bg-amber-500 text-slate-950 shadow-md'
                          : 'bg-slate-950 border border-slate-800 text-slate-300 hover:bg-slate-800'
                      }`}
                    >
                      {idx === 0 ? 'Best Stream' : `Mirror ${idx + 1}`}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Current Stream URL Box */}
            <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-slate-300 flex items-center gap-2">
                  <Film className="w-4 h-4 text-amber-400" />
                  Episode {currentEpisodeNum} Stream URL
                </span>

                {currentActiveUrl && (
                  <button
                    onClick={copyStreamUrlToClipboard}
                    className="flex items-center gap-1 text-amber-400 hover:text-amber-300 font-semibold cursor-pointer"
                  >
                    {copiedUrl ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedUrl ? 'Copied!' : 'Copy Stream URL'}</span>
                  </button>
                )}
              </div>

              <div className="font-mono text-[11px] text-slate-400 bg-slate-900 p-2.5 rounded-xl border border-slate-800/80 truncate">
                {currentActiveUrl || 'No stream URL loaded'}
              </div>
            </div>
          </div>

          {/* Episode Grid */}
          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-white uppercase tracking-wider">Episode Selector</span>
              <div className="flex items-center gap-3 text-[11px]">
                <span className="flex items-center gap-1 text-emerald-400 font-medium">
                  <span className="w-2 h-2 rounded-full bg-emerald-500" /> Synced
                </span>
                <span className="flex items-center gap-1 text-amber-400 font-medium">
                  <span className="w-2 h-2 rounded-full bg-amber-500" /> Pending (On-Demand)
                </span>
              </div>
            </div>

            <div className="grid grid-cols-5 sm:grid-cols-6 md:grid-cols-8 gap-2 max-h-48 overflow-y-auto pr-1 scrollbar-thin">
              {episodes.map((ep) => {
                const isSynced = ep.syncStatus === 'SYNCED' && (ep.bestUrl || ep.streamUrl);
                const isSelected = ep.episodeNumber === currentEpisodeNum;

                return (
                  <button
                    key={ep.episodeNumber}
                    onClick={() => loadEpisodeStream(ep.episodeNumber)}
                    className={`py-2 rounded-xl text-xs font-bold font-mono transition-all cursor-pointer flex flex-col items-center justify-center ${
                      isSelected
                        ? 'ring-2 ring-amber-400 scale-105 shadow-lg shadow-amber-500/20'
                        : ''
                    } ${
                      isSynced
                        ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-800 hover:bg-emerald-900'
                        : 'bg-amber-950/80 text-amber-300 border border-amber-800 hover:bg-amber-900'
                    }`}
                  >
                    <span>{ep.episodeNumber}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
