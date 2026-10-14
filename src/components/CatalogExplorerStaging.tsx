import React, { useState } from 'react';
import {
  Compass,
  Search,
  Filter,
  Layers,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Plus,
  CheckSquare,
  Square,
  RefreshCw,
  Info,
  TrendingUp,
  Database,
  ArrowRight,
  Eye,
} from 'lucide-react';

interface StagingDramaItem {
  collection_id: string;
  title: string;
  coverUrl: string;
  description?: string;
  categories: string[];
  totalEpisodes: number;
  source: string;
  inDb: boolean;
  dbTotalEpisodes?: number;
  dbSyncedEpisodes?: number;
  dbPendingEpisodes?: number;
  syncStatus?: string;
}

interface CategoryItem {
  categoryId: string;
  name: string;
  totalTitles: number;
}

interface CatalogExplorerStagingProps {
  categories: CategoryItem[];
  rateLimitSpeed: 'SAFE' | 'FAST';
  onImportComplete: () => void;
}

export const CatalogExplorerStaging: React.FC<CatalogExplorerStagingProps> = ({
  categories,
  rateLimitSpeed,
  onImportComplete,
}) => {
  const [explorerTab, setExplorerTab] = useState<'feed' | 'category' | 'crawl' | 'search'>('feed');

  // Mode 1: Feed
  const [feedSource, setFeedSource] = useState<'trending' | 'foryou' | 'both'>('both');
  const [feedPageFrom, setFeedPageFrom] = useState<number>(1);
  const [feedPageTo, setFeedPageTo] = useState<number>(3);

  // Mode 2: Category
  const [selectedCatId, setSelectedCatId] = useState<string>('all');

  // Mode 4: Search Keyword
  const [searchKeyword, setSearchKeyword] = useState<string>('CEO');

  // Staging state
  const [isFetching, setIsFetching] = useState<boolean>(false);
  const [fetchProgressMsg, setFetchProgressMsg] = useState<string>('');
  const [stagingItems, setStagingItems] = useState<StagingDramaItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [filterMode, setFilterMode] = useState<'all' | 'baru' | 'inDb'>('all');
  const [isImporting, setIsImporting] = useState<boolean>(false);

  const delayMs = rateLimitSpeed === 'SAFE' ? 12500 : 6500;

  // Helper: Compare against MongoDB via POST /api/dramas/check-existing
  const compareWithDatabase = async (rawItems: any[]): Promise<StagingDramaItem[]> => {
    const ids = rawItems.map((item) => item.collection_id).filter(Boolean);
    let existingMap: Record<string, any> = {};

    try {
      const res = await fetch('/api/dramas/check-existing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ collectionIds: ids }),
      });
      const data = await res.json();
      if (data.success) {
        existingMap = data.existingMap || {};
      }
    } catch (err) {
      console.error('Error checking existing dramas:', err);
    }

    return rawItems.map((item) => {
      const cid = item.collection_id;
      const dbInfo = existingMap[cid];
      const inDb = !!dbInfo;

      let dramaCats: string[] = [];
      if (typeof item.categories === 'string') {
        dramaCats = item.categories.split(',').map((c: string) => c.trim()).filter(Boolean);
      } else if (Array.isArray(item.tags)) {
        dramaCats = item.tags;
      }
      if (dramaCats.length === 0) dramaCats = ['General'];

      return {
        collection_id: cid,
        title: item.title,
        coverUrl: item.cover || item.coverUrl || '',
        description: item.description || '',
        categories: dramaCats,
        totalEpisodes: item.total_episodes || item.totalEpisodes || 30,
        source: item.source || 'PineDrama Discovery',
        inDb,
        dbTotalEpisodes: dbInfo?.dbTotalEpisodes,
        dbSyncedEpisodes: dbInfo?.dbSyncedEpisodes,
        dbPendingEpisodes: dbInfo?.dbPendingEpisodes,
        syncStatus: dbInfo?.syncStatus,
      };
    });
  };

  // Run Discovery Fetch according to Explorer Tab
  const handleRunExplore = async () => {
    setIsFetching(true);
    setStagingItems([]);
    setSelectedIds(new Set());
    setFetchProgressMsg('Initializing discovery crawl...');

    const discoveredRaw: any[] = [];

    try {
      if (explorerTab === 'feed') {
        const pages: number[] = [];
        for (let p = feedPageFrom; p <= feedPageTo; p++) pages.push(p);

        for (const page of pages) {
          if (feedSource === 'foryou' || feedSource === 'both') {
            setFetchProgressMsg(`Fetching ForYou Cursor/Page ${page}...`);
            const url = `https://api.sansekai.my.id/api/pinedrama/foryou?cursor=${page}&lang=id`;
            try {
              const res = await fetch(url, { headers: { Accept: '*/*' }, referrerPolicy: 'no-referrer' });
              if (res.ok) {
                const json = await res.json();
                (json.collections || []).forEach((item: any) => {
                  discoveredRaw.push({ ...item, source: `ForYou (Page ${page})` });
                });
              }
            } catch (err: any) {
              setFetchProgressMsg(`ForYou Page ${page} failed. Using proxy...`);
              const proxyRes = await fetch(`/api/proxy?targetUrl=/pinedrama/foryou&cursor=${page}&lang=id`);
              const proxyJson = await proxyRes.json();
              (proxyJson.collections || []).forEach((item: any) => {
                discoveredRaw.push({ ...item, source: `ForYou (Page ${page})` });
              });
            }
            await new Promise((r) => setTimeout(r, delayMs));
          }

          if (feedSource === 'trending' || feedSource === 'both') {
            setFetchProgressMsg(`Fetching Trending Cursor/Page ${page}...`);
            const url = `https://api.sansekai.my.id/api/pinedrama/trending?cursor=${page}&lang=id`;
            try {
              const res = await fetch(url, { headers: { Accept: '*/*' }, referrerPolicy: 'no-referrer' });
              if (res.ok) {
                const json = await res.json();
                (json.collections || []).forEach((item: any) => {
                  discoveredRaw.push({ ...item, source: `Trending (Page ${page})` });
                });
              }
            } catch (err: any) {
              const proxyRes = await fetch(`/api/proxy?targetUrl=/pinedrama/trending&cursor=${page}&lang=id`);
              const proxyJson = await proxyRes.json();
              (proxyJson.collections || []).forEach((item: any) => {
                discoveredRaw.push({ ...item, source: `Trending (Page ${page})` });
              });
            }
            await new Promise((r) => setTimeout(r, delayMs));
          }
        }
      } else if (explorerTab === 'search') {
        setFetchProgressMsg(`Searching PineDrama for "${searchKeyword}"...`);
        const url = `https://api.sansekai.my.id/api/pinedrama/search?query=${encodeURIComponent(searchKeyword)}&lang=id`;
        try {
          const res = await fetch(url, { headers: { Accept: '*/*' }, referrerPolicy: 'no-referrer' });
          if (res.ok) {
            const json = await res.json();
            (json.results || []).forEach((item: any) => {
              discoveredRaw.push({ ...item, source: `Search: "${searchKeyword}"` });
            });
          }
        } catch (err) {
          const proxyRes = await fetch(`/api/proxy?targetUrl=/pinedrama/search&query=${encodeURIComponent(searchKeyword)}&lang=id`);
          const proxyJson = await proxyRes.json();
          (proxyJson.results || []).forEach((item: any) => {
            discoveredRaw.push({ ...item, source: `Search: "${searchKeyword}"` });
          });
        }
      } else if (explorerTab === 'crawl' || explorerTab === 'category') {
        setFetchProgressMsg('Running Deep Discovery Crawl...');
        for (const page of [1, 2, 3]) {
          setFetchProgressMsg(`Deep Crawl: ForYou & Trending Page ${page}...`);
          const url1 = `https://api.sansekai.my.id/api/pinedrama/foryou?cursor=${page}&lang=id`;
          const res1 = await fetch(url1, { headers: { Accept: '*/*' }, referrerPolicy: 'no-referrer' }).catch(() => null);
          if (res1 && res1.ok) {
            const json = await res1.json();
            (json.collections || []).forEach((item: any) => {
              discoveredRaw.push({ ...item, source: `Deep Crawl (Page ${page})` });
            });
          }
          await new Promise((r) => setTimeout(r, delayMs));
        }
      }

      // Deduplicate discoveredRaw by collection_id
      const uniqueMap = new Map<string, any>();
      discoveredRaw.forEach((item) => {
        if (item.collection_id && !uniqueMap.has(item.collection_id)) {
          uniqueMap.set(item.collection_id, item);
        }
      });

      const uniqueList = Array.from(uniqueMap.values());
      setFetchProgressMsg(`Comparing ${uniqueList.length} discovered titles with MongoDB Atlas...`);

      const stagingFormatted = await compareWithDatabase(uniqueList);
      setStagingItems(stagingFormatted);

      // Pre-select all BARU items by default
      const baruIds = new Set(stagingFormatted.filter((i) => !i.inDb).map((i) => i.collection_id));
      setSelectedIds(baruIds);

      setFetchProgressMsg(`Discovery complete! Found ${stagingFormatted.length} total titles.`);
    } catch (err: any) {
      setFetchProgressMsg(`Error during fetch: ${err.message}`);
    } finally {
      setIsFetching(false);
    }
  };

  // Inspect / Check Total Episodes for a single drama if 0
  const handleCheckDramaEpisodes = async (collectionId: string) => {
    try {
      const url = `https://api.sansekai.my.id/api/pinedrama/get-episode?collection_id=${collectionId}&episodeNumber=1&lang=id`;
      const res = await fetch(url, { headers: { Accept: '*/*' }, referrerPolicy: 'no-referrer' });
      const data = await res.json();
      if (data && data.title) {
        alert(`Drama Metadata: ${data.title}\nVideo ID: ${data.video_id || 'N/A'}\nQuality: ${data.quality || 'HD_INDO'}`);
      }
    } catch (err: any) {
      alert(`Metadata inspect notice: ${err.message}`);
    }
  };

  // Import Selected / Batch to MongoDB
  const handleImportDramas = async (itemsToImport: StagingDramaItem[], sourceLabel: string) => {
    if (itemsToImport.length === 0) return;

    setIsImporting(true);
    try {
      const res = await fetch('/api/sync/import-dramas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dramas: itemsToImport,
          source: sourceLabel,
        }),
      });

      const data = await res.json();
      if (data.success) {
        alert(`Success! Imported ${data.importedCount} new dramas (+${data.totalNewEpisodes} episodes) into MongoDB Atlas.`);
        // Re-compare with DB to update staging badges
        const updatedStaging = await compareWithDatabase(stagingItems);
        setStagingItems(updatedStaging);
        onImportComplete();
      } else {
        alert(`Import error: ${data.error}`);
      }
    } catch (err: any) {
      alert(`Import error: ${err.message}`);
    } finally {
      setIsImporting(false);
    }
  };

  // Filtered Staging Items
  const filteredStaging = stagingItems.filter((item) => {
    if (filterMode === 'baru') return !item.inDb;
    if (filterMode === 'inDb') return item.inDb;
    return true;
  });

  const countBaru = stagingItems.filter((i) => !i.inDb).length;
  const countInDb = stagingItems.filter((i) => i.inDb).length;
  const totalNewEps = stagingItems.filter((i) => !i.inDb).reduce((acc, i) => acc + i.totalEpisodes, 0);

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredStaging.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredStaging.map((i) => i.collection_id)));
    }
  };

  const toggleSelectRow = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl space-y-6">
      {/* Header */}
      <div className="border-b border-slate-800 pb-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-black text-white flex items-center gap-2.5">
            <Compass className="w-6 h-6 text-amber-400" />
            PineDrama Catalog Explorer &amp; Staging Preview
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Explore PineDrama feeds &amp; categories with Staging Preview before importing to MongoDB Atlas.
          </p>
        </div>

        <div className="text-xs font-mono text-slate-400 bg-slate-950 px-3 py-1.5 rounded-xl border border-slate-800">
          Rate Limiter Slot: <span className="text-amber-400 font-bold">{rateLimitSpeed === 'SAFE' ? '12.5s' : '6.5s'}</span>
        </div>
      </div>

      {/* Explorer Mode Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 bg-slate-950 p-1.5 rounded-2xl border border-slate-800">
        <button
          onClick={() => setExplorerTab('feed')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
            explorerTab === 'feed'
              ? 'bg-amber-500 text-slate-950 shadow-md'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <TrendingUp className="w-4 h-4" />
          <span>1. Get by Feed (Trending / ForYou)</span>
        </button>

        <button
          onClick={() => setExplorerTab('category')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
            explorerTab === 'category'
              ? 'bg-amber-500 text-slate-950 shadow-md'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <Filter className="w-4 h-4" />
          <span>2. Get by Category</span>
        </button>

        <button
          onClick={() => setExplorerTab('crawl')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
            explorerTab === 'crawl'
              ? 'bg-amber-500 text-slate-950 shadow-md'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <Compass className="w-4 h-4" />
          <span>3. Deep Discovery Crawl</span>
        </button>

        <button
          onClick={() => setExplorerTab('search')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
            explorerTab === 'search'
              ? 'bg-amber-500 text-slate-950 shadow-md'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <Search className="w-4 h-4" />
          <span>4. Search Keyword</span>
        </button>
      </div>

      {/* Explorer Controls per Tab */}
      <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-4">
        {explorerTab === 'feed' && (
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end text-xs">
            <div className="md:col-span-4">
              <label className="block text-slate-400 font-semibold mb-1">Source Feed</label>
              <select
                value={feedSource}
                onChange={(e: any) => setFeedSource(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 text-white rounded-xl px-3 py-2.5 font-semibold focus:outline-none focus:border-amber-500 cursor-pointer"
              >
                <option value="both">Both Trending &amp; ForYou</option>
                <option value="foryou">ForYou Only</option>
                <option value="trending">Trending Only</option>
              </select>
            </div>

            <div className="md:col-span-3">
              <label className="block text-slate-400 font-semibold mb-1">Page / Cursor From</label>
              <input
                type="number"
                min={1}
                max={10}
                value={feedPageFrom}
                onChange={(e) => setFeedPageFrom(parseInt(e.target.value, 10) || 1)}
                className="w-full bg-slate-900 border border-slate-800 text-white rounded-xl px-3 py-2.5 font-mono focus:outline-none focus:border-amber-500"
              />
            </div>

            <div className="md:col-span-3">
              <label className="block text-slate-400 font-semibold mb-1">Page / Cursor To</label>
              <input
                type="number"
                min={1}
                max={10}
                value={feedPageTo}
                onChange={(e) => setFeedPageTo(parseInt(e.target.value, 10) || 3)}
                className="w-full bg-slate-900 border border-slate-800 text-white rounded-xl px-3 py-2.5 font-mono focus:outline-none focus:border-amber-500"
              />
            </div>

            <div className="md:col-span-2">
              <button
                onClick={handleRunExplore}
                disabled={isFetching}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-amber-500 text-slate-950 font-bold text-xs hover:bg-amber-400 transition-all cursor-pointer disabled:opacity-50"
              >
                {isFetching ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                <span>Fetch Feed</span>
              </button>
            </div>
          </div>
        )}

        {explorerTab === 'category' && (
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end text-xs">
            <div className="md:col-span-10">
              <label className="block text-slate-400 font-semibold mb-1">Select Synced Category</label>
              <select
                value={selectedCatId}
                onChange={(e) => setSelectedCatId(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 text-white rounded-xl px-3 py-2.5 font-semibold focus:outline-none focus:border-amber-500 cursor-pointer"
              >
                <option value="all">All Categories ({categories.length} available)</option>
                {categories.map((c) => (
                  <option key={c.categoryId} value={c.categoryId}>
                    {c.name} ({c.totalTitles} Titles)
                  </option>
                ))}
              </select>
            </div>

            <div className="md:col-span-2">
              <button
                onClick={handleRunExplore}
                disabled={isFetching}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-amber-500 text-slate-950 font-bold text-xs hover:bg-amber-400 transition-all cursor-pointer disabled:opacity-50"
              >
                {isFetching ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Filter className="w-4 h-4" />}
                <span>Fetch Category</span>
              </button>
            </div>
          </div>
        )}

        {explorerTab === 'search' && (
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end text-xs">
            <div className="md:col-span-10">
              <label className="block text-slate-400 font-semibold mb-1">Keyword Search</label>
              <input
                type="text"
                value={searchKeyword}
                onChange={(e) => setSearchKeyword(e.target.value)}
                placeholder="e.g. CEO, Cinta, Miliarder, Balas dendam"
                className="w-full bg-slate-900 border border-slate-800 text-white rounded-xl px-3 py-2.5 font-semibold focus:outline-none focus:border-amber-500"
              />
            </div>

            <div className="md:col-span-2">
              <button
                onClick={handleRunExplore}
                disabled={isFetching}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-amber-500 text-slate-950 font-bold text-xs hover:bg-amber-400 transition-all cursor-pointer disabled:opacity-50"
              >
                {isFetching ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                <span>Search</span>
              </button>
            </div>
          </div>
        )}

        {explorerTab === 'crawl' && (
          <div className="flex flex-col md:flex-row items-center justify-between gap-4 text-xs">
            <div>
              <div className="font-bold text-white">Deep Discovery Crawl</div>
              <p className="text-slate-400 mt-0.5">
                Automatically iterate through ForYou, Trending, and synced categories to discover all PineDrama titles.
              </p>
            </div>

            <button
              onClick={handleRunExplore}
              disabled={isFetching}
              className="px-6 py-2.5 rounded-xl bg-amber-500 text-slate-950 font-bold hover:bg-amber-400 transition-all cursor-pointer disabled:opacity-50 shrink-0 flex items-center gap-2"
            >
              {isFetching ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Compass className="w-4 h-4" />}
              <span>Start Deep Crawl</span>
            </button>
          </div>
        )}

        {fetchProgressMsg && (
          <div className="text-xs font-mono text-amber-300 bg-slate-900 p-2.5 rounded-xl border border-slate-800 flex items-center gap-2">
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? 'animate-spin' : ''}`} />
            <span>{fetchProgressMsg}</span>
          </div>
        )}
      </div>

      {/* Staging / Discovery Preview Table */}
      {stagingItems.length > 0 && (
        <div className="space-y-4 pt-2">
          {/* Controls & Fast Filters */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-950 p-4 rounded-xl border border-slate-800">
            {/* Filter Pills */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setFilterMode('all')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer ${
                  filterMode === 'all'
                    ? 'bg-amber-500 text-slate-950'
                    : 'bg-slate-900 border border-slate-800 text-slate-300'
                }`}
              >
                All Discovered ({stagingItems.length})
              </button>

              <button
                onClick={() => setFilterMode('baru')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer ${
                  filterMode === 'baru'
                    ? 'bg-emerald-500 text-slate-950'
                    : 'bg-slate-900 border border-slate-800 text-emerald-400'
                }`}
              >
                🟢 Only BARU ({countBaru})
              </button>

              <button
                onClick={() => setFilterMode('inDb')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer ${
                  filterMode === 'inDb'
                    ? 'bg-blue-500 text-slate-950'
                    : 'bg-slate-900 border border-slate-800 text-blue-400'
                }`}
              >
                🔵 In DB ({countInDb})
              </button>
            </div>

            {/* Batch Action Buttons */}
            <div className="flex items-center gap-2 flex-wrap">
              {countBaru > 0 && (
                <button
                  onClick={() => {
                    const baruList = stagingItems.filter((i) => !i.inDb);
                    handleImportDramas(baruList, `Batch Import (${explorerTab})`);
                  }}
                  disabled={isImporting}
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition-colors cursor-pointer disabled:opacity-50 flex items-center gap-2 shadow-lg shadow-emerald-600/20"
                >
                  <Plus className="w-4 h-4" />
                  <span>Simpan Semua Drama BARU (+{countBaru} Title / +{totalNewEps} Eps)</span>
                </button>
              )}

              {selectedIds.size > 0 && (
                <button
                  onClick={() => {
                    const selectedList = stagingItems.filter((i) => selectedIds.has(i.collection_id));
                    handleImportDramas(selectedList, `Selected Import (${explorerTab})`);
                  }}
                  disabled={isImporting}
                  className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs transition-colors cursor-pointer disabled:opacity-50 flex items-center gap-2 shadow-lg shadow-amber-500/20"
                >
                  <CheckSquare className="w-4 h-4" />
                  <span>Simpan Dicentang ({selectedIds.size}) ke DB</span>
                </button>
              )}
            </div>
          </div>

          {/* Staging Table */}
          <div className="overflow-x-auto bg-slate-950 rounded-2xl border border-slate-800">
            <table className="w-full text-left text-sm border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 text-xs font-semibold uppercase tracking-wider bg-slate-900/60">
                  <th className="py-3 px-4 w-10">
                    <button onClick={toggleSelectAll} className="cursor-pointer text-slate-400 hover:text-white">
                      {selectedIds.size === filteredStaging.length && filteredStaging.length > 0 ? (
                        <CheckSquare className="w-4 h-4 text-amber-400" />
                      ) : (
                        <Square className="w-4 h-4" />
                      )}
                    </button>
                  </th>
                  <th className="py-3 px-4">Drama Title</th>
                  <th className="py-3 px-4">Source &amp; Category</th>
                  <th className="py-3 px-4">Detected Episodes</th>
                  <th className="py-3 px-4">DB Status</th>
                  <th className="py-3 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-slate-300 text-xs">
                {filteredStaging.map((item) => {
                  const isChecked = selectedIds.has(item.collection_id);

                  return (
                    <tr key={item.collection_id} className="hover:bg-slate-900/50 transition-colors">
                      <td className="py-3 px-4">
                        <button
                          onClick={() => toggleSelectRow(item.collection_id)}
                          className="cursor-pointer text-slate-400 hover:text-white"
                        >
                          {isChecked ? (
                            <CheckSquare className="w-4 h-4 text-amber-400" />
                          ) : (
                            <Square className="w-4 h-4" />
                          )}
                        </button>
                      </td>

                      <td className="py-3 px-4 font-medium text-white max-w-xs">
                        <div className="flex items-center gap-3">
                          <img
                            src={item.coverUrl || 'https://via.placeholder.com/80x110'}
                            alt={item.title}
                            className="w-10 h-14 object-cover rounded-lg bg-slate-900 shrink-0"
                            referrerPolicy="no-referrer"
                            onError={(e) => {
                              (e.target as HTMLElement).style.display = 'none';
                            }}
                          />
                          <div className="overflow-hidden">
                            <div className="font-bold text-white truncate">{item.title}</div>
                            <div className="text-[10px] text-slate-500 font-mono">ID: {item.collection_id}</div>
                          </div>
                        </div>
                      </td>

                      <td className="py-3 px-4 text-slate-400">
                        <div className="font-semibold text-amber-300">{item.source}</div>
                        <div className="text-[11px] text-slate-400 truncate max-w-xs">
                          {item.categories.join(', ')}
                        </div>
                      </td>

                      <td className="py-3 px-4 font-mono font-bold text-slate-200">
                        {item.totalEpisodes > 0 ? (
                          <span>{item.totalEpisodes} Episodes</span>
                        ) : (
                          <button
                            onClick={() => handleCheckDramaEpisodes(item.collection_id)}
                            className="flex items-center gap-1 text-amber-400 hover:text-amber-300 underline font-semibold text-[11px] cursor-pointer"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>Cek Total Episode</span>
                          </button>
                        )}
                      </td>

                      <td className="py-3 px-4">
                        {!item.inDb ? (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-bold bg-emerald-950 text-emerald-300 border border-emerald-800">
                            🟢 BARU (Belum Ada)
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-bold bg-blue-950 text-blue-300 border border-blue-800">
                            🔵 SUDAH ADA ({item.dbSyncedEpisodes} / {item.dbTotalEpisodes} Synced)
                          </span>
                        )}
                      </td>

                      <td className="py-3 px-4 text-right">
                        {!item.inDb ? (
                          <button
                            onClick={() => handleImportDramas([item], item.source)}
                            disabled={isImporting}
                            className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition-colors cursor-pointer disabled:opacity-50 flex items-center gap-1 ml-auto"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            <span>+ Masukkan ke DB ({item.totalEpisodes} Eps)</span>
                          </button>
                        ) : (
                          <span className="text-[11px] text-slate-500 italic">Saved in MongoDB</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
