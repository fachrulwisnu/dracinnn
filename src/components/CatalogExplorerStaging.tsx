import React, { useState, useEffect } from 'react';
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
  Eye,
  Globe,
  Wand2,
} from 'lucide-react';
import { extractDramaItemsFromResponse, normalizeDramaItem, normalizeMeloloDetail } from '../../services/providerAdapter';
import { resolveCoverUrl, handleImageError } from '../utils/imageUtils';

interface StagingDramaItem {
  provider: 'pinedrama' | 'melolo' | string;
  collection_id: string;
  title: string;
  coverUrl: string;
  description?: string;
  synopsis?: string;
  categories: string[];
  totalEpisodes: number;
  source: string;
  inDb: boolean;
  dbTotalEpisodes?: number;
  dbSyncedEpisodes?: number;
  dbPendingEpisodes?: number;
  syncStatus?: string;
  raw?: any;
}

interface CategoryItem {
  provider?: string;
  categoryId?: string;
  category_id?: string;
  name?: string;
  category_name?: string;
  totalTitles?: number;
}

interface CatalogExplorerStagingProps {
  categories: CategoryItem[];
  rateLimitSpeed: 'SAFE' | 'FAST';
  onImportComplete: () => void;
}

const fallbackMeloloCategories: CategoryItem[] = [
  { category_id: "romantis", categoryId: "romantis", name: "Romansa Urban & CEO", totalTitles: 24, provider: "melolo" },
  { category_id: "perkotaan", categoryId: "perkotaan", name: "Kehidupan Perkotaan", totalTitles: 18, provider: "melolo" },
  { category_id: "serangan-balik", categoryId: "serangan-balik", name: "Serangan Balik & Balas Dendam", totalTitles: 30, provider: "melolo" },
  { category_id: "fantasi", categoryId: "fantasi", name: "Fantasi & Drama", totalTitles: 15, provider: "melolo" },
];

/**
 * Safe Fetch Wrapper that guarantees valid JSON responses.
 * If direct browser fetch returns HTML or non-JSON, it falls back safely without throwing raw errors.
 */
async function fetchSansekaiJson(targetUrl: string): Promise<any> {
  let fullUrl = targetUrl;
  if (!fullUrl.startsWith('http://') && !fullUrl.startsWith('https://')) {
    if (fullUrl.startsWith('/')) {
      fullUrl = `https://api.sansekai.my.id${fullUrl}`;
    } else {
      fullUrl = `https://api.sansekai.my.id/api/${fullUrl}`;
    }
  }

  try {
    const res = await fetch(fullUrl, {
      headers: {
        Accept: 'application/json, text/plain, */*',
      },
      referrerPolicy: 'no-referrer',
      credentials: 'omit',
    });

    const contentType = res.headers.get('content-type') || '';

    if (res.ok && contentType.includes('application/json')) {
      const json = await res.json();
      return json;
    }

    // Response is HTML or non-JSON, fallback to proxy
    console.warn(`[Safe Fetch] Direct fetch to ${fullUrl} returned content-type "${contentType}". Routing to proxy...`);
    const proxyUrl = `/api/proxy-sansekai?url=${encodeURIComponent(fullUrl)}`;
    const proxyRes = await fetch(proxyUrl);
    if (proxyRes.ok) {
      const proxyJson = await proxyRes.json();
      if (proxyJson && typeof proxyJson === 'object' && !Array.isArray(proxyJson) && 'error' in proxyJson) {
        return null;
      }
      return proxyJson;
    }
  } catch (err: any) {
    console.warn(`[Safe Fetch] Exception fetching ${fullUrl}: ${err.message}. Routing to proxy...`);
    try {
      const proxyUrl = `/api/proxy-sansekai?url=${encodeURIComponent(fullUrl)}`;
      const proxyRes = await fetch(proxyUrl);
      if (proxyRes.ok) {
        return await proxyRes.json();
      }
    } catch (proxyErr) {
      console.error(`[Safe Fetch] Proxy also failed for ${fullUrl}:`, proxyErr);
    }
  }
  return null;
}

export const CatalogExplorerStaging: React.FC<CatalogExplorerStagingProps> = ({
  categories: initialCategories,
  rateLimitSpeed,
  onImportComplete,
}) => {
  // Provider Selection: 'melolo' | 'pinedrama' | 'all'
  const [selectedProvider, setSelectedProvider] = useState<'pinedrama' | 'melolo' | 'all'>('melolo');
  const [explorerTab, setExplorerTab] = useState<'feed' | 'category' | 'crawl' | 'search'>('feed');

  // Feed Sources
  const [pinedramaFeedSource, setPinedramaFeedSource] = useState<'trending' | 'latest' | 'foryou' | 'all'>('all');
  const [meloloFeedSource, setMeloloFeedSource] = useState<'trending' | 'latest' | 'foryou' | 'anime' | 'all'>('all');
  const [feedPageFrom, setFeedPageFrom] = useState<number>(1);
  const [feedPageTo, setFeedPageTo] = useState<number>(3);

  // Category List
  const [apiCategories, setApiCategories] = useState<CategoryItem[]>([]);
  const [selectedCatId, setSelectedCatId] = useState<string>('all');

  // Search Keyword
  const [searchKeyword, setSearchKeyword] = useState<string>('Pewaris');

  // Staging State
  const [isFetching, setIsFetching] = useState<boolean>(false);
  const [fetchProgressMsg, setFetchProgressMsg] = useState<string>('');
  const [stagingItems, setStagingItems] = useState<StagingDramaItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [filterMode, setFilterMode] = useState<'all' | 'baru' | 'inDb'>('all');
  const [isImporting, setIsImporting] = useState<boolean>(false);

  const delayMs = rateLimitSpeed === 'SAFE' ? 12500 : 6500;

  // Load API Category List dynamically when provider changes
  useEffect(() => {
    async function loadApiCategoryList() {
      const prov = selectedProvider === 'all' ? 'melolo' : selectedProvider;
      const url = `https://api.sansekai.my.id/api/${prov}/get-category-list?lang=id`;
      const json = await fetchSansekaiJson(url);
      const items = extractDramaItemsFromResponse(json);

      if (items && items.length > 0) {
        setApiCategories(items);
      } else if (prov === 'melolo') {
        setApiCategories(fallbackMeloloCategories);
      } else {
        setApiCategories([]);
      }
    }
    loadApiCategoryList();
  }, [selectedProvider]);

  // Check against MongoDB Atlas per Provider
  const compareWithDatabase = async (rawItems: StagingDramaItem[]): Promise<StagingDramaItem[]> => {
    if (rawItems.length === 0) return [];

    const ids = rawItems.map((item) => item.collection_id).filter(Boolean);
    let existingMap: Record<string, any> = {};

    try {
      const res = await fetch('/api/dramas/check-existing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: selectedProvider,
          collectionIds: ids,
        }),
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

      return {
        ...item,
        inDb,
        dbTotalEpisodes: dbInfo?.dbTotalEpisodes,
        dbSyncedEpisodes: dbInfo?.dbSyncedEpisodes,
        dbPendingEpisodes: dbInfo?.dbPendingEpisodes,
        syncStatus: dbInfo?.syncStatus,
      };
    });
  };

  // Main Discovery Exploration Handler
  const handleRunExplore = async (
    overrideCatId?: string | React.SyntheticEvent,
    overrideProv?: 'pinedrama' | 'melolo' | 'all',
    overrideTab?: 'feed' | 'category' | 'crawl' | 'search'
  ) => {
    const activeCatId = typeof overrideCatId === 'string' ? overrideCatId : selectedCatId;
    const activeProvider = (typeof overrideProv === 'string' ? overrideProv : selectedProvider) as 'pinedrama' | 'melolo' | 'all';
    const activeTab = (typeof overrideTab === 'string' ? overrideTab : explorerTab) as 'feed' | 'category' | 'crawl' | 'search';

    setIsFetching(true);
    setStagingItems([]);
    setSelectedIds(new Set());
    setFetchProgressMsg(`Initializing ${activeProvider.toUpperCase()} discovery...`);

    const discoveredNormalized: StagingDramaItem[] = [];

    try {
      // 1. MELOLO DISCOVERY
      if (activeProvider === 'melolo' || activeProvider === 'all') {
        if (activeTab === 'feed') {
          const pages = [];
          for (let p = feedPageFrom; p <= feedPageTo; p++) pages.push(p);

          for (const p of pages) {
            if (meloloFeedSource === 'trending' || meloloFeedSource === 'all') {
              setFetchProgressMsg(`Fetching Melolo Trending Page ${p}...`);
              const url = `https://api.sansekai.my.id/api/melolo/trending?page=${p}&lang=id`;
              const json = await fetchSansekaiJson(url);
              const items = extractDramaItemsFromResponse(json);
              items.forEach((b) => {
                const norm = normalizeDramaItem(b, 'melolo', `Melolo Trending (P${p})`);
                discoveredNormalized.push({ ...norm, inDb: false });
              });
              await new Promise((r) => setTimeout(r, 1000));
            }

            if (meloloFeedSource === 'latest' || meloloFeedSource === 'all') {
              setFetchProgressMsg(`Fetching Melolo Latest Page ${p}...`);
              const url = `https://api.sansekai.my.id/api/melolo/get-latest?page=${p}&lang=id`;
              const json = await fetchSansekaiJson(url);
              const items = extractDramaItemsFromResponse(json);
              items.forEach((b) => {
                const norm = normalizeDramaItem(b, 'melolo', `Melolo Latest (P${p})`);
                discoveredNormalized.push({ ...norm, inDb: false });
              });
              await new Promise((r) => setTimeout(r, 1000));
            }

            if (meloloFeedSource === 'foryou' || meloloFeedSource === 'all') {
              setFetchProgressMsg(`Fetching Melolo ForYou Page ${p}...`);
              const url = `https://api.sansekai.my.id/api/melolo/foryou?page=${p}&lang=id`;
              const json = await fetchSansekaiJson(url);
              const items = extractDramaItemsFromResponse(json);
              items.forEach((b) => {
                const norm = normalizeDramaItem(b, 'melolo', `Melolo ForYou (P${p})`);
                discoveredNormalized.push({ ...norm, inDb: false });
              });
              await new Promise((r) => setTimeout(r, 1000));
            }

            if (meloloFeedSource === 'anime') {
              setFetchProgressMsg(`Fetching Melolo Anime Page ${p}...`);
              const url = `https://api.sansekai.my.id/api/melolo/anime?page=${p}&lang=id`;
              const json = await fetchSansekaiJson(url);
              const items = extractDramaItemsFromResponse(json);
              items.forEach((b) => {
                const norm = normalizeDramaItem(b, 'melolo', `Melolo Anime (P${p})`);
                discoveredNormalized.push({ ...norm, inDb: false });
              });
              await new Promise((r) => setTimeout(r, 1000));
            }
          }
        } else if (activeTab === 'category') {
          const catId = activeCatId === 'all' ? 'romantis' : activeCatId;
          for (let p = feedPageFrom; p <= feedPageTo; p++) {
            setFetchProgressMsg(`Fetching Melolo Category "${catId}" Page ${p}...`);
            const url = `https://api.sansekai.my.id/api/melolo/get-by-category?category_id=${catId}&page=${p}&lang=id`;
            const json = await fetchSansekaiJson(url);
            let items = extractDramaItemsFromResponse(json);

            // Fallback if category endpoint returned empty/HTML
            if (items.length === 0) {
              setFetchProgressMsg(`Fallback to Melolo Trending for Category "${catId}"...`);
              const fallbackUrl = `https://api.sansekai.my.id/api/melolo/trending?page=${p}&lang=id`;
              const fallbackJson = await fetchSansekaiJson(fallbackUrl);
              items = extractDramaItemsFromResponse(fallbackJson);
            }

            items.forEach((b) => {
              const norm = normalizeDramaItem(b, 'melolo', `Melolo Category "${catId}" (P${p})`);
              discoveredNormalized.push({ ...norm, inDb: false });
            });
            await new Promise((r) => setTimeout(r, 1000));
          }
        } else if (activeTab === 'search') {
          for (let p = 1; p <= 3; p++) {
            setFetchProgressMsg(`Searching Melolo for "${searchKeyword}" Page ${p}...`);
            const url = `https://api.sansekai.my.id/api/melolo/search?query=${encodeURIComponent(searchKeyword)}&q=${encodeURIComponent(searchKeyword)}&keyword=${encodeURIComponent(searchKeyword)}&page=${p}&lang=id`;
            const json = await fetchSansekaiJson(url);
            const items = extractDramaItemsFromResponse(json);
            items.forEach((b) => {
              const norm = normalizeDramaItem(b, 'melolo', `Melolo Search: "${searchKeyword}" (P${p})`);
              discoveredNormalized.push({ ...norm, inDb: false });
            });
            if (items.length === 0) break;
            await new Promise((r) => setTimeout(r, 1000));
          }
        } else if (activeTab === 'crawl') {
          setFetchProgressMsg('Running Melolo Deep Discovery Crawl...');
          const endpoints = [
            'https://api.sansekai.my.id/api/melolo/trending?page=1&lang=id',
            'https://api.sansekai.my.id/api/melolo/get-latest?page=1&lang=id',
            'https://api.sansekai.my.id/api/melolo/foryou?page=1&lang=id',
            'https://api.sansekai.my.id/api/melolo/anime?page=1&lang=id',
          ];
          for (const ep of endpoints) {
            setFetchProgressMsg(`Melolo Crawling: ${ep}...`);
            const json = await fetchSansekaiJson(ep);
            const items = extractDramaItemsFromResponse(json);
            items.forEach((b) => {
              const norm = normalizeDramaItem(b, 'melolo', 'Melolo Deep Crawl');
              discoveredNormalized.push({ ...norm, inDb: false });
            });
            await new Promise((r) => setTimeout(r, 1000));
          }
        }
      }

      // 2. PINEDRAMA DISCOVERY
      if (activeProvider === 'pinedrama' || activeProvider === 'all') {
        if (activeTab === 'feed') {
          const pages = [];
          for (let p = feedPageFrom; p <= feedPageTo; p++) pages.push(p);

          for (const p of pages) {
            if (pinedramaFeedSource === 'trending' || pinedramaFeedSource === 'all') {
              setFetchProgressMsg(`Fetching PineDrama Trending Page ${p}...`);
              const url = `https://api.sansekai.my.id/api/pinedrama/trending?page=${p}&lang=id`;
              const json = await fetchSansekaiJson(url);
              const items = extractDramaItemsFromResponse(json);
              items.forEach((item: any) => {
                const norm = normalizeDramaItem(item, 'pinedrama', `PineDrama Trending (P${p})`);
                discoveredNormalized.push({ ...norm, inDb: false });
              });
              await new Promise((r) => setTimeout(r, 1000));
            }

            if (pinedramaFeedSource === 'latest' || pinedramaFeedSource === 'all') {
              setFetchProgressMsg(`Fetching PineDrama Latest Page ${p}...`);
              const url = `https://api.sansekai.my.id/api/pinedrama/get-latest?page=${p}&lang=id`;
              const json = await fetchSansekaiJson(url);
              const items = extractDramaItemsFromResponse(json);
              items.forEach((item: any) => {
                const norm = normalizeDramaItem(item, 'pinedrama', `PineDrama Latest (P${p})`);
                discoveredNormalized.push({ ...norm, inDb: false });
              });
              await new Promise((r) => setTimeout(r, 1000));
            }

            if (pinedramaFeedSource === 'foryou' || pinedramaFeedSource === 'all') {
              setFetchProgressMsg(`Fetching PineDrama ForYou Page ${p}...`);
              const url = `https://api.sansekai.my.id/api/pinedrama/foryou?page=${p}&lang=id`;
              const json = await fetchSansekaiJson(url);
              const items = extractDramaItemsFromResponse(json);
              items.forEach((item: any) => {
                const norm = normalizeDramaItem(item, 'pinedrama', `PineDrama ForYou (P${p})`);
                discoveredNormalized.push({ ...norm, inDb: false });
              });
              await new Promise((r) => setTimeout(r, 1000));
            }
          }
        } else if (activeTab === 'category') {
          const catId = activeCatId === 'all' ? '1' : activeCatId;
          for (let p = feedPageFrom; p <= feedPageTo; p++) {
            setFetchProgressMsg(`Fetching PineDrama Category "${catId}" Page ${p}...`);
            const url = `https://api.sansekai.my.id/api/pinedrama/get-by-category?category_id=${catId}&page=${p}&lang=id`;
            const json = await fetchSansekaiJson(url);
            const items = extractDramaItemsFromResponse(json);
            items.forEach((b) => {
              const norm = normalizeDramaItem(b, 'pinedrama', `PineDrama Category ${catId} (P${p})`);
              discoveredNormalized.push({ ...norm, inDb: false });
            });
            await new Promise((r) => setTimeout(r, 1000));
          }
        } else if (activeTab === 'search') {
          for (let p = 1; p <= 3; p++) {
            setFetchProgressMsg(`Searching PineDrama for "${searchKeyword}" Page ${p}...`);
            const url = `https://api.sansekai.my.id/api/pinedrama/search?query=${encodeURIComponent(searchKeyword)}&q=${encodeURIComponent(searchKeyword)}&keyword=${encodeURIComponent(searchKeyword)}&page=${p}&lang=id`;
            const json = await fetchSansekaiJson(url);
            const items = extractDramaItemsFromResponse(json);
            items.forEach((item: any) => {
              const norm = normalizeDramaItem(item, 'pinedrama', `PineDrama Search: "${searchKeyword}" (P${p})`);
              discoveredNormalized.push({ ...norm, inDb: false });
            });
            if (items.length === 0) break;
            await new Promise((r) => setTimeout(r, 1000));
          }
        } else if (activeTab === 'crawl') {
          setFetchProgressMsg('Running PineDrama Deep Discovery Crawl...');
          const endpoints = [
            'https://api.sansekai.my.id/api/pinedrama/trending?page=1&lang=id',
            'https://api.sansekai.my.id/api/pinedrama/get-latest?page=1&lang=id',
            'https://api.sansekai.my.id/api/pinedrama/foryou?page=1&lang=id',
          ];
          for (const ep of endpoints) {
            setFetchProgressMsg(`PineDrama Crawling: ${ep}...`);
            const json = await fetchSansekaiJson(ep);
            const items = extractDramaItemsFromResponse(json);
            items.forEach((item: any) => {
              const norm = normalizeDramaItem(item, 'pinedrama', 'PineDrama Deep Crawl');
              discoveredNormalized.push({ ...norm, inDb: false });
            });
            await new Promise((r) => setTimeout(r, 1000));
          }
        }
      }

      // Deduplicate by provider + collection_id
      const uniqueMap = new Map<string, StagingDramaItem>();
      discoveredNormalized.forEach((item) => {
        const key = `${item.provider}_${item.collection_id}`;
        if (item.collection_id && !uniqueMap.has(key)) {
          uniqueMap.set(key, item);
        }
      });

      const uniqueList = Array.from(uniqueMap.values());
      setFetchProgressMsg(`Comparing ${uniqueList.length} discovered titles with MongoDB Atlas...`);

      const stagingFormatted = await compareWithDatabase(uniqueList);
      setStagingItems(stagingFormatted);

      const baruIds = new Set(stagingFormatted.filter((i) => !i.inDb).map((i) => `${i.provider}_${i.collection_id}`));
      setSelectedIds(baruIds);

      setFetchProgressMsg(`Discovery complete! Found ${stagingFormatted.length} total titles.`);
    } catch (err: any) {
      setFetchProgressMsg(`Error during fetch: ${err.message}`);
    } finally {
      setIsFetching(false);
    }
  };

  const [isEnrichingStaging, setIsEnrichingStaging] = useState<boolean>(false);

  // Auto-enrich Melolo items in staging with true covers, categories, and video_list
  const handleEnrichMeloloStaging = async () => {
    if (isEnrichingStaging || stagingItems.length === 0) return;
    setIsEnrichingStaging(true);
    setFetchProgressMsg('Auto-enriching Melolo items in staging via /api/melolo/detail...');

    try {
      const updatedStaging = [...stagingItems];
      let enrichedCount = 0;

      for (let i = 0; i < updatedStaging.length; i++) {
        const item = updatedStaging[i];
        if (item.provider !== 'melolo') continue;

        setFetchProgressMsg(`[${i + 1}/${updatedStaging.length}] Enriching Melolo detail for "${item.title}"...`);

        try {
          const detailUrl = `https://api.sansekai.my.id/api/melolo/detail?book_id=${item.collection_id}&lang=id`;
          const rawJson = await fetchSansekaiJson(detailUrl);

          if (rawJson) {
            const normDetail = normalizeMeloloDetail(rawJson, item.source);

            if (normDetail.collection_id) {
              updatedStaging[i] = {
                ...item,
                title: normDetail.title || item.title,
                coverUrl: normDetail.coverUrl || item.coverUrl,
                synopsis: normDetail.synopsis || item.synopsis,
                categories: normDetail.categories?.length > 0 ? normDetail.categories : item.categories,
                totalEpisodes: normDetail.totalEpisodes || item.totalEpisodes,
                raw: rawJson,
              };
              enrichedCount++;
            }
          }
        } catch (e) {
          console.warn(`Error enriching ${item.collection_id}:`, e);
        }

        await new Promise((r) => setTimeout(r, 1000));
      }

      const reChecked = await compareWithDatabase(updatedStaging);
      setStagingItems(reChecked);
      setFetchProgressMsg(`✔ Successfully enriched ${enrichedCount} Melolo titles in staging!`);
    } catch (err: any) {
      setFetchProgressMsg(`Error enriching staging: ${err.message}`);
    } finally {
      setIsEnrichingStaging(false);
    }
  };

  // Chunked Import Selected / Batch to MongoDB (5 dramas per chunk)
  const handleImportDramas = async (itemsToImport: StagingDramaItem[], sourceLabel: string) => {
    if (itemsToImport.length === 0) return;

    setIsImporting(true);
    setFetchProgressMsg(`Starting chunked import of ${itemsToImport.length} dramas...`);

    try {
      const CHUNK_SIZE = 5;
      let totalImported = 0;
      let totalEpsAdded = 0;

      for (let i = 0; i < itemsToImport.length; i += CHUNK_SIZE) {
        const chunk = itemsToImport.slice(i, i + CHUNK_SIZE);
        const chunkProvider = chunk[0]?.provider || selectedProvider;

        setFetchProgressMsg(`Importing chunk [${i + 1}-${Math.min(i + CHUNK_SIZE, itemsToImport.length)}/${itemsToImport.length}] to ${chunkProvider.toUpperCase()}...`);

        const res = await fetch('/api/sync/import-dramas', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            provider: chunkProvider,
            dramas: chunk,
            source: sourceLabel,
          }),
        });

        const data = await res.json();

        // Trigger detail enrichment update for Melolo items with raw payload
        for (const item of chunk) {
          if (item.provider === 'melolo' && item.raw) {
            await fetch('/api/dramas/update-melolo-detail', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                collection_id: item.collection_id,
                rawDetail: item.raw,
              }),
            }).catch(() => {});
          }
        }

        if (data.success) {
          totalImported += data.importedCount || 0;
          totalEpsAdded += data.totalNewEpisodes || 0;
        }
      }

      alert(`Sukses! Berhasil menyimpan ${totalImported} drama baru (+${totalEpsAdded} episode) ke MongoDB Atlas.`);
      const updatedStaging = await compareWithDatabase(stagingItems);
      setStagingItems(updatedStaging);
      onImportComplete();
    } catch (err: any) {
      alert(`Import error: ${err.message}`);
    } finally {
      setIsImporting(false);
      setFetchProgressMsg('');
    }
  };

  // Category click handler for Melolo / PineDrama categories
  const handleCategoryClick = (cat: CategoryItem) => {
    const id = cat.categoryId || cat.category_id || 'romantis';
    const catProv = (cat.provider as 'pinedrama' | 'melolo' | 'all') || (selectedProvider === 'all' ? 'melolo' : selectedProvider);
    setSelectedCatId(id);
    if (catProv) setSelectedProvider(catProv);
    setExplorerTab('category');
    handleRunExplore(id, catProv, 'category');
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
      setSelectedIds(new Set(filteredStaging.map((i) => `${i.provider}_${i.collection_id}`)));
    }
  };

  const toggleSelectRow = (key: string) => {
    const next = new Set(selectedIds);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSelectedIds(next);
  };

  const allDisplayCategories = [...apiCategories, ...initialCategories];

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl space-y-6">
      {/* Header & Provider Selector */}
      <div className="border-b border-slate-800 pb-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-black text-white flex items-center gap-2.5">
            <Compass className="w-6 h-6 text-amber-400" />
            Dracin Populer — Catalog Explorer &amp; Staging Preview
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Explore PineDrama &amp; Melolo catalogs directly via browser fetch before importing to MongoDB Atlas (`pinedrama_*` / `melolo_*`).
          </p>
        </div>

        {/* Provider Switcher Dropdown */}
        <div className="bg-slate-950 p-1.5 rounded-xl border border-slate-800 flex items-center gap-2">
          <Globe className="w-4 h-4 text-amber-400 shrink-0 ml-1" />
          <span className="text-xs text-slate-400 font-semibold">Target Provider:</span>
          <select
            value={selectedProvider}
            onChange={(e: any) => setSelectedProvider(e.target.value)}
            className="bg-slate-900 border border-slate-800 text-white text-xs font-bold rounded-lg px-3 py-1.5 focus:outline-none focus:border-amber-500 cursor-pointer"
          >
            <option value="melolo">🍈 Melolo (/melolo/...)</option>
            <option value="pinedrama">🌲 PineDrama (/pinedrama/...)</option>
            <option value="all">🌐 All Providers (Multi-Crawl)</option>
          </select>
        </div>
      </div>

      {/* Category Pills Bar */}
      {allDisplayCategories.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-bold text-slate-400 flex items-center gap-2">
            <Layers className="w-4 h-4 text-amber-400" />
            <span>Kategori {selectedProvider.toUpperCase()} Tersedia (Klik untuk langsung eksplorasi):</span>
          </div>
          <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-thin">
            {allDisplayCategories.slice(0, 10).map((cat, idx) => {
              const catId = cat.categoryId || cat.category_id || String(idx + 1);
              const catName = cat.name || cat.category_name || `Kategori ${catId}`;
              const isSelected = selectedCatId === catId && explorerTab === 'category';

              return (
                <button
                  key={catId + idx}
                  onClick={() => handleCategoryClick(cat)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap border shrink-0 ${
                    isSelected
                      ? 'bg-amber-500 text-slate-950 border-amber-400 shadow-md'
                      : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-amber-500/50 hover:text-white'
                  }`}
                >
                  {catName}
                </button>
              );
            })}
          </div>
        </div>
      )}

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
          <span>1. Get by Feed ({selectedProvider.toUpperCase()})</span>
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

      {/* Explorer Controls */}
      <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-4">
        {explorerTab === 'feed' && (
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end text-xs">
            <div className="md:col-span-4">
              <label className="block text-slate-400 font-semibold mb-1">
                {selectedProvider.toUpperCase()} Feed Source
              </label>
              {selectedProvider === 'melolo' ? (
                <select
                  value={meloloFeedSource}
                  onChange={(e: any) => setMeloloFeedSource(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 text-white rounded-xl px-3 py-2.5 font-semibold focus:outline-none focus:border-amber-500 cursor-pointer"
                >
                  <option value="all">🌐 All Melolo Feeds</option>
                  <option value="trending">🍈 Melolo Trending (/melolo/trending)</option>
                  <option value="latest">🍈 Melolo Latest (/melolo/get-latest)</option>
                  <option value="foryou">🍈 Melolo ForYou (/melolo/foryou)</option>
                  <option value="anime">🍈 Melolo Anime (/melolo/anime)</option>
                </select>
              ) : (
                <select
                  value={pinedramaFeedSource}
                  onChange={(e: any) => setPinedramaFeedSource(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 text-white rounded-xl px-3 py-2.5 font-semibold focus:outline-none focus:border-amber-500 cursor-pointer"
                >
                  <option value="all">🌐 All PineDrama Feeds</option>
                  <option value="trending">🌲 PineDrama Trending (/pinedrama/trending)</option>
                  <option value="latest">🌲 PineDrama Latest (/pinedrama/get-latest)</option>
                  <option value="foryou">🌲 PineDrama ForYou (/pinedrama/foryou)</option>
                </select>
              )}
            </div>

            <div className="md:col-span-2">
              <label className="block text-slate-400 font-semibold mb-1">Page From</label>
              <input
                type="number"
                min={1}
                max={10}
                value={feedPageFrom}
                onChange={(e) => setFeedPageFrom(parseInt(e.target.value, 10) || 1)}
                className="w-full bg-slate-900 border border-slate-800 text-white rounded-xl px-3 py-2.5 font-mono focus:outline-none focus:border-amber-500"
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-slate-400 font-semibold mb-1">Page To</label>
              <input
                type="number"
                min={1}
                max={10}
                value={feedPageTo}
                onChange={(e) => setFeedPageTo(parseInt(e.target.value, 10) || 3)}
                className="w-full bg-slate-900 border border-slate-800 text-white rounded-xl px-3 py-2.5 font-mono focus:outline-none focus:border-amber-500"
              />
            </div>

            <div className="md:col-span-4">
              <button
                onClick={handleRunExplore}
                disabled={isFetching}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-amber-500 text-slate-950 font-bold text-xs hover:bg-amber-400 transition-all cursor-pointer disabled:opacity-50"
              >
                {isFetching ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                <span>Fetch {selectedProvider.toUpperCase()} Feed</span>
              </button>
            </div>
          </div>
        )}

        {explorerTab === 'category' && (
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end text-xs">
            <div className="md:col-span-10">
              <label className="block text-slate-400 font-semibold mb-1">Select Category ({selectedProvider.toUpperCase()})</label>
              <select
                value={selectedCatId}
                onChange={(e) => setSelectedCatId(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 text-white rounded-xl px-3 py-2.5 font-semibold focus:outline-none focus:border-amber-500 cursor-pointer"
              >
                <option value="all">All Categories ({allDisplayCategories.length} available)</option>
                {allDisplayCategories.map((c, idx) => {
                  const id = c.categoryId || c.category_id || String(idx + 1);
                  const name = c.name || c.category_name || `Kategori ${id}`;
                  return (
                    <option key={id + idx} value={id}>
                      [{c.provider ? c.provider.toUpperCase() : selectedProvider.toUpperCase()}] {name} {c.totalTitles ? `(${c.totalTitles} Titles)` : ''}
                    </option>
                  );
                })}
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
              <label className="block text-slate-400 font-semibold mb-1">Keyword Search ({selectedProvider.toUpperCase()})</label>
              <input
                type="text"
                value={searchKeyword}
                onChange={(e) => setSearchKeyword(e.target.value)}
                placeholder="e.g. Pewaris, CEO, Cinta, Suami, Ayah"
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
                <span>Search Keyword</span>
              </button>
            </div>
          </div>
        )}

        {explorerTab === 'crawl' && (
          <div className="flex flex-col md:flex-row items-center justify-between gap-4 text-xs">
            <div>
              <div className="font-bold text-white">Deep Discovery Crawl ({selectedProvider.toUpperCase()})</div>
              <p className="text-slate-400 mt-0.5">
                Automatically iterate through endpoints across {selectedProvider.toUpperCase()} to discover all drama titles.
              </p>
            </div>

            <button
              onClick={handleRunExplore}
              disabled={isFetching}
              className="px-6 py-2.5 rounded-xl bg-amber-500 text-slate-950 font-bold hover:bg-amber-400 transition-all cursor-pointer disabled:opacity-50 shrink-0 flex items-center gap-2"
            >
              {isFetching ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Compass className="w-4 h-4" />}
              <span>Start Crawl</span>
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

      {/* Staging Preview Table */}
      {stagingItems.length > 0 && (
        <div className="space-y-4 pt-2">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-950 p-4 rounded-xl border border-slate-800">
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

            <div className="flex items-center gap-2 flex-wrap">
              {stagingItems.some((i) => i.provider === 'melolo') && (
                <button
                  onClick={handleEnrichMeloloStaging}
                  disabled={isEnrichingStaging}
                  className="px-3.5 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-rose-500 text-slate-950 font-bold text-xs transition-colors cursor-pointer disabled:opacity-50 flex items-center gap-1.5 shadow-md"
                >
                  <Wand2 className={`w-3.5 h-3.5 ${isEnrichingStaging ? 'animate-spin' : ''}`} />
                  <span>{isEnrichingStaging ? 'Enriching Melolo...' : '✨ Auto-Enrich Melolo Detail'}</span>
                </button>
              )}

              {countBaru > 0 && (
                <button
                  onClick={() => {
                    const baruList = stagingItems.filter((i) => !i.inDb);
                    handleImportDramas(baruList, `Batch Import (${selectedProvider.toUpperCase()})`);
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
                    const selectedList = stagingItems.filter((i) => selectedIds.has(`${i.provider}_${i.collection_id}`));
                    handleImportDramas(selectedList, `Selected Import (${selectedProvider.toUpperCase()})`);
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
                  <th className="py-3 px-4">Provider</th>
                  <th className="py-3 px-4">Drama Title</th>
                  <th className="py-3 px-4">Source &amp; Category</th>
                  <th className="py-3 px-4">Detected Episodes</th>
                  <th className="py-3 px-4">DB Status</th>
                  <th className="py-3 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-slate-300 text-xs">
                {filteredStaging.map((item) => {
                  const key = `${item.provider}_${item.collection_id}`;
                  const isChecked = selectedIds.has(key);

                  return (
                    <tr key={key} className="hover:bg-slate-900/50 transition-colors">
                      <td className="py-3 px-4">
                        <button
                          onClick={() => toggleSelectRow(key)}
                          className="cursor-pointer text-slate-400 hover:text-white"
                        >
                          {isChecked ? (
                            <CheckSquare className="w-4 h-4 text-amber-400" />
                          ) : (
                            <Square className="w-4 h-4" />
                          )}
                        </button>
                      </td>

                      <td className="py-3 px-4">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${
                            item.provider === 'melolo'
                              ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
                              : 'bg-indigo-950 text-indigo-300 border-indigo-800'
                          }`}
                        >
                          {item.provider === 'melolo' ? '🍈 MELOLO' : '🌲 PINEDRAMA'}
                        </span>
                      </td>

                      <td className="py-3 px-4 font-medium text-white max-w-xs">
                        <div className="flex items-center gap-3">
                          <img
                            src={resolveCoverUrl(item.coverUrl)}
                            alt={item.title}
                            className="w-10 h-14 object-cover rounded-lg bg-slate-900 shrink-0"
                            referrerPolicy="no-referrer"
                            onError={(e) => handleImageError(e, item.coverUrl)}
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
                        <span>{item.totalEpisodes} Episodes</span>
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
