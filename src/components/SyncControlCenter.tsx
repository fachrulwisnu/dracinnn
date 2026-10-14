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
  Filter,
  Wand2,
  Edit3,
  RefreshCw,
  FileText,
} from 'lucide-react';
import { EndpointInspector } from './EndpointInspector';
import { CatalogExplorerStaging } from './CatalogExplorerStaging';
import { NewlyAddedHistory } from './NewlyAddedHistory';
import { EditDramaModal } from './EditDramaModal';
import { resolveCoverUrl, handleImageError } from '../utils/imageUtils';

interface DramaItem {
  provider?: string;
  dramaId: string;
  collection_id?: string;
  book_id?: string;
  title: string;
  coverUrl: string;
  synopsis?: string;
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
  onSelectDrama: (dramaId: string, provider?: string) => void;
  onClearLogs: () => void;
  onSortChange: (sortKey: string) => void;
  onProviderFilterChange: (provider: string) => void;
  selectedTableProvider: string;
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
  onProviderFilterChange,
  selectedTableProvider,
  onRefreshAllData,
  loadingAction,
}) => {
  const [logFilter, setLogFilter] = useState<string>('');
  const [activeSubTab, setActiveSubTab] = useState<'explorer' | 'history' | 'inspector'>('explorer');
  const [sortOption, setSortOption] = useState<string>('importedAt_desc');

  // Edit Drama Modal State
  const [editingDrama, setEditingDrama] = useState<DramaItem | null>(null);

  // Bulk Cleanup & Purge State
  const [purgeProvider, setPurgeProvider] = useState<'pinedrama' | 'melolo'>('melolo');
  const [purgeTarget, setPurgeTarget] = useState<'delete_by_category' | 'reset_all_pending' | 'purge_all_dramas'>('delete_by_category');
  const [selectedPurgeCategory, setSelectedPurgeCategory] = useState<string>('');
  const [isCleaningUp, setIsCleaningUp] = useState<boolean>(false);

  // Synopsis Audit State
  const [synopsisAudit, setSynopsisAudit] = useState<any | null>(null);
  const [isResyncingSynopsis, setIsResyncingSynopsis] = useState<boolean>(false);

  // Audit synopsis on load
  const runSynopsisAudit = async () => {
    try {
      const res = await fetch('/api/dramas/audit-synopsis');
      const data = await res.json();
      if (data.success) {
        setSynopsisAudit(data);
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    runSynopsisAudit();
  }, [dramas]);

  // Handle Clean Contamination
  const handleCleanupContamination = async () => {
    if (!confirm('Apakah Anda yakin ingin membersihkan data Melolo yang bercampur di tabel PineDrama? Data Melolo akan dipindahkan ke koleksi melolo_* dan dihapus dari pinedrama_*.')) {
      return;
    }
    setIsCleaningUp(true);
    try {
      const res = await fetch('/api/admin/cleanup-melolo-in-pinedrama', { method: 'POST' });
      const data = await res.json();
      alert(data.message);
      onRefreshAllData();
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    } finally {
      setIsCleaningUp(false);
    }
  };

  // Handle Purge Provider Data
  const handleExecutePurge = async () => {
    if (!confirm(`Konfirmasi: Hapus / reset data pada provider ${purgeProvider.toUpperCase()} (${purgeTarget})? Action ini tidak dapat dibatalkan.`)) {
      return;
    }
    setIsCleaningUp(true);
    try {
      const res = await fetch('/api/admin/purge-provider-data', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: purgeProvider,
          actionTarget: purgeTarget,
          categoryName: selectedPurgeCategory,
        }),
      });
      const data = await res.json();
      alert(data.message);
      onRefreshAllData();
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    } finally {
      setIsCleaningUp(false);
    }
  };

  // Handle Delete Drama
  const handleDeleteDrama = async (drama: DramaItem) => {
    const prov = drama.provider || 'pinedrama';
    const id = drama.book_id || drama.collection_id || drama.dramaId;
    if (!confirm(`Hapus drama "${drama.title}" beserta seluruh episodenya dari koleksi ${prov.toUpperCase()}?`)) {
      return;
    }

    try {
      const res = await fetch(`/api/dramas/${prov}/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        alert(data.message);
        onRefreshAllData();
      } else {
        alert(`Gagal: ${data.error}`);
      }
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    }
  };

  // Resync Synopsis via Browser Fetch
  const handleResyncSynopsisBatch = async () => {
    if (!synopsisAudit || synopsisAudit.totalNeedyCount === 0 || isResyncingSynopsis) return;
    setIsResyncingSynopsis(true);

    try {
      const needyList = [...(synopsisAudit.meloloNeedyList || []), ...(synopsisAudit.pineNeedyList || [])];

      for (let i = 0; i < needyList.length; i++) {
        const item = needyList[i];
        const prov = item.provider;
        const id = item.dramaId;

        try {
          if (prov === 'melolo') {
            const url = `https://api.sansekai.my.id/api/melolo/detail?book_id=${id}&lang=id`;
            const res = await fetch(url, { headers: { Accept: '*/*' }, referrerPolicy: 'no-referrer' });
            if (res.ok) {
              const json = await res.json();
              await fetch('/api/dramas/update-melolo-detail', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ collection_id: id, rawDetail: json }),
              });
            }
          }
        } catch (e) {}

        await new Promise((r) => setTimeout(r, 2000));
      }

      alert('Selesai melakukan resync sinopsis & detail!');
      runSynopsisAudit();
      onRefreshAllData();
    } catch (err: any) {
      alert(`Error resync: ${err.message}`);
    } finally {
      setIsResyncingSynopsis(false);
    }
  };

  const handleSortChangeInternal = (key: string) => {
    setSortOption(key);
    onSortChange(key);
  };

  return (
    <div className="min-h-screen text-slate-100 p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-8">
      {/* 1. Control Action Bar */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800/80 pb-4">
          <div>
            <h1 className="text-2xl font-black text-white flex items-center gap-3">
              <Zap className="w-6 h-6 text-amber-400" />
              Dracin Populer — Sync &amp; DB Management Center
            </h1>
            <p className="text-xs text-slate-400 mt-1">
              Multi-provider (PineDrama &amp; Melolo) rate-limited database management directly targeting MongoDB Atlas (`dracin_db`).
            </p>
          </div>
        </div>

        {/* Bulk Cleanup & Contamination Purging Tools */}
        <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-4">
          <div className="text-sm font-bold text-white flex items-center gap-2">
            <Trash2 className="w-4 h-4 text-rose-400" />
            <span>Manajemen Pembersihan Data (Bulk Cleanup &amp; Contamination Purger)</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end text-xs">
            <div className="md:col-span-5">
              <button
                onClick={handleCleanupContamination}
                disabled={isCleaningUp}
                className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-rose-600 to-amber-600 hover:from-rose-500 hover:to-amber-500 text-white font-bold transition-all shadow-md cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <Trash2 className="w-4 h-4" />
                <span>🗑️ Bersihkan Data Melolo di Tabel PineDrama (Cleanup Contamination)</span>
              </button>
            </div>

            <div className="md:col-span-2">
              <label className="block text-slate-400 font-semibold mb-1">Provider</label>
              <select
                value={purgeProvider}
                onChange={(e: any) => setPurgeProvider(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 text-white font-semibold rounded-lg px-2.5 py-2 focus:outline-none focus:border-amber-500"
              >
                <option value="melolo">Melolo</option>
                <option value="pinedrama">PineDrama</option>
              </select>
            </div>

            <div className="md:col-span-3">
              <label className="block text-slate-400 font-semibold mb-1">Target Action</label>
              <select
                value={purgeTarget}
                onChange={(e: any) => setPurgeTarget(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 text-white font-semibold rounded-lg px-2.5 py-2 focus:outline-none focus:border-amber-500"
              >
                <option value="delete_by_category">Delete by Tag / Kategori</option>
                <option value="reset_all_pending">Reset Semua Failed ke Pending</option>
                <option value="purge_all_dramas">Hapus Semua Drama di Provider Ini</option>
              </select>
            </div>

            {purgeTarget === 'delete_by_category' && (
              <div className="md:col-span-2">
                <input
                  type="text"
                  placeholder="Nama Kategori..."
                  value={selectedPurgeCategory}
                  onChange={(e) => setSelectedPurgeCategory(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 text-white rounded-lg px-2.5 py-2"
                />
              </div>
            )}

            <div className="md:col-span-2">
              <button
                onClick={handleExecutePurge}
                disabled={isCleaningUp}
                className="w-full py-2 px-3 rounded-xl bg-slate-800 border border-slate-700 text-rose-300 hover:bg-rose-950 hover:text-rose-200 font-bold transition-all cursor-pointer disabled:opacity-50"
              >
                Eksekusi Purge
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Synopsis Audit & Resync Banner */}
      {synopsisAudit && synopsisAudit.totalNeedyCount > 0 && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-5 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <FileText className="w-6 h-6 text-amber-400 shrink-0" />
            <div>
              <div className="text-sm font-bold text-amber-200">
                Audit Sinopsis / Deskripsi: Ditemukan {synopsisAudit.totalNeedyCount} drama belum memiliki sinopsis!
              </div>
              <div className="text-xs text-slate-400 mt-0.5">
                Melolo: {synopsisAudit.meloloNeedyCount} drama · PineDrama: {synopsisAudit.pineNeedyCount} drama
              </div>
            </div>
          </div>

          <button
            onClick={handleResyncSynopsisBatch}
            disabled={isResyncingSynopsis}
            className="px-5 py-2.5 rounded-xl bg-amber-500 text-slate-950 font-bold text-xs hover:bg-amber-400 transition-colors shadow-md cursor-pointer flex items-center gap-2 shrink-0 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${isResyncingSynopsis ? 'animate-spin' : ''}`} />
            <span>{isResyncingSynopsis ? 'Resyncing Sinopsis...' : '🔄 Resync Sinopsis & Detail'}</span>
          </button>
        </div>
      )}

      {/* 2. Live Stats Counter */}
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

      {/* 3. Sub-Tab Section */}
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
            rateLimitSpeed="SAFE"
            onImportComplete={onRefreshAllData}
          />
        )}

        {activeSubTab === 'history' && (
          <NewlyAddedHistory
            onPrioritizeDrama={(id) => {
              onPrioritizeDrama(id);
            }}
            onRefreshData={onRefreshAllData}
          />
        )}

        {activeSubTab === 'inspector' && <EndpointInspector />}
      </div>

      {/* 4. Drama Table with CRUD Actions & Isolated Provider Filter */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl space-y-4 p-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-4">
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Database className="w-5 h-5 text-amber-400" />
              Tabel Koleksi Drama &amp; CRUD Manager
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Isolated provider collection documents stored in MongoDB Atlas (`dracin_db`).
            </p>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            {/* Provider Filter */}
            <div className="flex items-center gap-2 bg-slate-950 p-1.5 rounded-xl border border-slate-800 text-xs">
              <Filter className="w-4 h-4 text-amber-400 shrink-0 ml-1" />
              <span className="text-slate-400 font-semibold">Provider Filter:</span>
              <select
                value={selectedTableProvider}
                onChange={(e) => onProviderFilterChange(e.target.value)}
                className="bg-slate-900 border border-slate-800 text-white font-semibold rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-amber-500 cursor-pointer"
              >
                <option value="all">Semua Provider</option>
                <option value="pinedrama">🌲 PineDrama (pinedrama_dramas)</option>
                <option value="melolo">🍈 Melolo (melolo_dramas)</option>
              </select>
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
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm border-collapse">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400 text-xs font-semibold uppercase tracking-wider bg-slate-950/40">
                <th className="py-3 px-4">Provider</th>
                <th className="py-3 px-4">Drama Title</th>
                <th className="py-3 px-4">Category</th>
                <th className="py-3 px-4">Episodes Synced / Total</th>
                <th className="py-3 px-4">Progress Bar</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">CRUD Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-slate-300">
              {dramas.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-500 italic">
                    No dramas in MongoDB yet. Use the Catalog Explorer above to preview and import titles!
                  </td>
                </tr>
              ) : (
                dramas.map((drama) => {
                  const percentage =
                    drama.totalEpisodes > 0
                      ? Math.min(100, Math.round((drama.syncedEpisodesCount / drama.totalEpisodes) * 100))
                      : 0;

                  const prov = drama.provider || 'pinedrama';
                  const id = (drama as any).book_id || drama.collection_id || (drama as any).series_id_str || drama.dramaId || (drama as any)._id || (drama as any).id;

                  return (
                    <tr key={id} className="hover:bg-slate-800/40 transition-colors">
                      <td className="py-3.5 px-4">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${
                            prov === 'melolo'
                              ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
                              : 'bg-indigo-950 text-indigo-300 border-indigo-800'
                          }`}
                        >
                          {prov === 'melolo' ? '🍈 MELOLO' : '🌲 PINEDRAMA'}
                        </span>
                      </td>

                      <td className="py-3.5 px-4 font-medium text-white max-w-xs truncate">
                        <div className="flex items-center gap-3">
                          <img
                            src={resolveCoverUrl(drama.coverUrl)}
                            alt={drama.title}
                            className="w-10 h-14 object-cover rounded-lg bg-slate-800 shrink-0"
                            referrerPolicy="no-referrer"
                            onError={(e) => handleImageError(e, drama.coverUrl)}
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
                              ID: {id}
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

                      <td className="py-3.5 px-4 w-40">
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

                      <td className="py-3.5 px-4 text-right space-x-1.5 whitespace-nowrap">
                        <button
                          onClick={() => id && onSelectDrama(id, prov)}
                          className="px-2.5 py-1.5 rounded-lg bg-slate-800 text-slate-200 text-xs font-semibold hover:bg-slate-700 transition-colors cursor-pointer"
                        >
                          View Episodes
                        </button>

                        <button
                          onClick={() => setEditingDrama(drama)}
                          className="px-2.5 py-1.5 rounded-lg bg-amber-500/10 text-amber-300 border border-amber-500/20 text-xs font-semibold hover:bg-amber-500 hover:text-slate-950 transition-all cursor-pointer"
                          title="Edit Title, Cover, Synopsis"
                        >
                          <Edit3 className="w-3.5 h-3.5 inline mr-1" />
                          Edit
                        </button>

                        <button
                          onClick={() => handleDeleteDrama(drama)}
                          className="px-2.5 py-1.5 rounded-lg bg-rose-950/80 text-rose-300 border border-rose-800 text-xs font-semibold hover:bg-rose-600 hover:text-white transition-all cursor-pointer"
                          title="Hapus Drama &amp; Seluruh Episodenya"
                        >
                          <Trash2 className="w-3.5 h-3.5 inline mr-1" />
                          Hapus
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

      {/* Edit Drama Modal */}
      {editingDrama && (
        <EditDramaModal
          drama={editingDrama}
          onClose={() => setEditingDrama(null)}
          onSaveComplete={onRefreshAllData}
        />
      )}
    </div>
  );
};
