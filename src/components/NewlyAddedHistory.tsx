import React, { useEffect, useState } from 'react';
import { Sparkles, Calendar, Layers, Play, CheckCircle2, RefreshCw, Film } from 'lucide-react';
import { resolveCoverUrl, handleImageError } from '../utils/imageUtils';

interface NewlyAddedDrama {
  dramaId: string;
  title: string;
  coverUrl?: string;
  totalEpisodes: number;
  categories?: string[];
}

interface NewlyAddedLogEntry {
  _id: string;
  source: string;
  totalImported: number;
  totalNewEpisodes: number;
  dramas: NewlyAddedDrama[];
  importedAt: string;
}

interface NewlyAddedHistoryProps {
  onPrioritizeDrama: (dramaId: string) => void;
  onRefreshData: () => void;
}

export const NewlyAddedHistory: React.FC<NewlyAddedHistoryProps> = ({
  onPrioritizeDrama,
  onRefreshData,
}) => {
  const [logs, setLogs] = useState<NewlyAddedLogEntry[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const fetchNewlyAdded = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/sync/newly-added');
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setLogs(data.logs || []);
        }
      }
    } catch (err) {
      console.error('Error fetching newly added logs:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchNewlyAdded();
  }, []);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-amber-400" />
            Riwayat Drama Baru Masuk (Newly Added Log)
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Daftar drama baru yang dimasukkan ke MongoDB Atlas beserta informasi sumber dan jumlah episode.
          </p>
        </div>

        <button
          onClick={() => {
            fetchNewlyAdded();
            onRefreshData();
          }}
          disabled={isLoading}
          className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 transition-colors cursor-pointer"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          <span>Refresh Log</span>
        </button>
      </div>

      {logs.length === 0 ? (
        <div className="bg-slate-950 p-8 rounded-xl border border-slate-800 text-center text-slate-500 italic space-y-2">
          <Film className="w-10 h-10 text-slate-700 mx-auto" />
          <p>Belum ada riwayat drama baru. Gunakan Catalog Explorer di atas untuk memasukkan drama baru!</p>
        </div>
      ) : (
        <div className="space-y-6">
          {logs.map((log) => {
            const dateStr = new Date(log.importedAt).toLocaleString('id-ID', {
              dateStyle: 'medium',
              timeStyle: 'short',
            });

            return (
              <div key={log._id} className="bg-slate-950 border border-slate-800 rounded-2xl p-5 space-y-4 shadow-lg">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800/80 pb-3">
                  <div className="flex items-center gap-3">
                    <span className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                      <CheckCircle2 className="w-4 h-4" />
                    </span>
                    <div>
                      <div className="text-sm font-bold text-white">
                        Batch Import: {log.source}
                      </div>
                      <div className="text-xs text-slate-400 flex items-center gap-2 mt-0.5">
                        <Calendar className="w-3.5 h-3.5 text-slate-500" />
                        <span>{dateStr}</span>
                        <span aria-hidden="true">·</span>
                        <span className="text-amber-400 font-mono font-semibold">
                          +{log.totalImported} Drama BARU (+{log.totalNewEpisodes} Episodes Pending)
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Drama List */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {log.dramas.map((drama) => (
                    <div
                      key={drama.dramaId}
                      className="bg-slate-900 border border-slate-800/80 p-3 rounded-xl flex items-center justify-between gap-3 hover:border-amber-500/40 transition-colors"
                    >
                      <div className="flex items-center gap-3 overflow-hidden">
                        <img
                          src={resolveCoverUrl(drama.coverUrl)}
                          alt={drama.title}
                          className="w-10 h-14 object-cover rounded-lg bg-slate-950 shrink-0"
                          referrerPolicy="no-referrer"
                          onError={(e) => handleImageError(e, drama.coverUrl)}
                        />
                        <div className="overflow-hidden">
                          <div className="text-xs font-bold text-white truncate">{drama.title}</div>
                          <div className="text-[11px] text-slate-400 mt-0.5">
                            {drama.totalEpisodes} Episode <span className="text-emerald-400 font-bold ml-1">BARU</span>
                          </div>
                          <div className="text-[10px] text-slate-500 truncate">
                            {drama.categories?.join(', ')}
                          </div>
                        </div>
                      </div>

                      <button
                        onClick={() => onPrioritizeDrama(drama.dramaId)}
                        title="Prioritize & Sync Episode Sekarang"
                        className="px-2.5 py-1.5 rounded-lg bg-amber-500 text-slate-950 font-bold text-[11px] hover:bg-amber-400 transition-colors cursor-pointer shrink-0 flex items-center gap-1"
                      >
                        <Play className="w-3 h-3 fill-current" />
                        <span>Sync</span>
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
