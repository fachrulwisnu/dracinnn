import React, { useEffect, useState, useCallback } from 'react';
import { Header } from './components/Header';
import { SyncControlCenter } from './components/SyncControlCenter';
import { DracinPortal } from './components/DracinPortal';
import { AutoEpisodeFetcher } from './components/AutoEpisodeFetcher';
import { EpisodeInspectorModal } from './components/EpisodeInspectorModal';

export default function App() {
  const [activeTab, setActiveTab] = useState<'portal' | 'fetcher' | 'sync'>('portal');
  const [categories, setCategories] = useState<any[]>([]);
  const [dramas, setDramas] = useState<any[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<string>('all');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [sortOption, setSortOption] = useState<string>('importedAt_desc');
  const [tableProviderFilter, setTableProviderFilter] = useState<string>('all');

  const [workerState, setWorkerState] = useState<any>({
    isRunning: false,
    isPaused: false,
    currentTask: 'IDLE',
    requestsMadeInCurrentMinute: 0,
    logs: [],
  });

  const [counters, setCounters] = useState<any>({
    totalCategories: 0,
    totalDramas: 0,
    syncedEpisodes: 0,
    pendingEpisodes: 0,
  });

  const [loadingAction, setLoadingAction] = useState<string | null>(null);

  // Inspector / Player Modal State
  const [selectedDramaDetail, setSelectedDramaDetail] = useState<any | null>(null);
  const [selectedDramaEpisodes, setSelectedDramaEpisodes] = useState<any[]>([]);

  // Fetch Sync Status
  const fetchSyncStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/sync/status?provider=${selectedProvider}`);
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setWorkerState(data.workerState || {});
          setCounters(data.counters || {});
        }
      }
    } catch (err) {
      console.error('Error polling sync status:', err);
    }
  }, [selectedProvider]);

  // Fetch Categories
  const fetchCategories = useCallback(async () => {
    try {
      const url = new URL('/api/categories', window.location.origin);
      if (selectedProvider !== 'all') {
        url.searchParams.set('provider', selectedProvider);
      }
      const res = await fetch(url.toString());
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setCategories(data.categories || []);
        }
      }
    } catch (err) {
      console.error('Error fetching categories:', err);
    }
  }, [selectedProvider]);

  // Fetch Dramas
  const fetchDramas = useCallback(async () => {
    try {
      const url = new URL('/api/dramas', window.location.origin);
      const prov = activeTab === 'portal' ? selectedProvider : tableProviderFilter;
      if (prov !== 'all') {
        url.searchParams.set('provider', prov);
      }
      if (selectedCategory !== 'all') {
        url.searchParams.set('categoryId', selectedCategory);
      }
      if (searchQuery.trim()) {
        url.searchParams.set('q', searchQuery.trim());
      }
      if (sortOption) {
        url.searchParams.set('sort', sortOption);
      }
      const res = await fetch(url.toString());
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setDramas(data.dramas || []);
        }
      }
    } catch (err) {
      console.error('Error fetching dramas:', err);
    }
  }, [selectedProvider, tableProviderFilter, selectedCategory, searchQuery, sortOption, activeTab]);

  // Initial load
  useEffect(() => {
    fetchCategories();
    fetchDramas();
    fetchSyncStatus();
  }, [fetchCategories, fetchDramas, fetchSyncStatus]);

  // Polling sync status every 4s
  useEffect(() => {
    const interval = setInterval(() => {
      fetchSyncStatus();
      fetchDramas();
    }, 4000);
    return () => clearInterval(interval);
  }, [fetchSyncStatus, fetchDramas]);

  // Handlers for Control Center Actions
  const handleTriggerCategories = async () => {
    setLoadingAction('categories');
    try {
      await fetch('/api/sync/categories', { method: 'POST' });
      await fetchSyncStatus();
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingAction(null);
    }
  };

  const handleResumeWorker = async () => {
    setLoadingAction('resume');
    try {
      await fetch('/api/sync/episodes/resume', { method: 'POST' });
      await fetchSyncStatus();
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingAction(null);
    }
  };

  const handlePauseWorker = async () => {
    setLoadingAction('pause');
    try {
      await fetch('/api/sync/pause', { method: 'POST' });
      await fetchSyncStatus();
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingAction(null);
    }
  };

  const handlePrioritizeDrama = async (dramaId: string) => {
    try {
      await fetch(`/api/sync/drama/${dramaId}`, { method: 'POST' });
      await fetchSyncStatus();
    } catch (err) {
      console.error(err);
    }
  };

  const handleClearLogs = async () => {
    try {
      await fetch('/api/sync/logs', { method: 'DELETE' });
      await fetchSyncStatus();
    } catch (err) {
      console.error(err);
    }
  };

  const handleRefreshAllData = () => {
    fetchCategories();
    fetchDramas();
    fetchSyncStatus();
  };

  // Open Episode Inspector Modal for a Drama
  const handleSelectDrama = async (dramaId: string, provider?: string) => {
    if (!dramaId) return;
    try {
      const url = provider ? `/api/dramas/${dramaId}?provider=${provider}` : `/api/dramas/${dramaId}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setSelectedDramaDetail(data.drama);
          setSelectedDramaEpisodes(data.episodes || []);
        }
      }
    } catch (err) {
      console.error('Error fetching drama detail:', err);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0d14] text-slate-100 font-sans antialiased selection:bg-amber-500 selection:text-slate-950">
      <Header
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        isRunning={workerState.isRunning}
        isPaused={workerState.isPaused}
        pendingCount={counters.pendingEpisodes || 0}
        onRefresh={handleRefreshAllData}
      />

      <main className="pb-12">
        {activeTab === 'portal' && (
          <DracinPortal
            categories={categories}
            dramas={dramas}
            selectedProvider={selectedProvider}
            onSelectProvider={setSelectedProvider}
            selectedCategory={selectedCategory}
            onSelectCategory={setSelectedCategory}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            onSelectDrama={handleSelectDrama}
          />
        )}

        {activeTab === 'fetcher' && (
          <AutoEpisodeFetcher onRefreshData={handleRefreshAllData} />
        )}

        {activeTab === 'sync' && (
          <SyncControlCenter
            workerState={workerState}
            counters={counters}
            dramas={dramas}
            categories={categories}
            onTriggerCategories={handleTriggerCategories}
            onResumeWorker={handleResumeWorker}
            onPauseWorker={handlePauseWorker}
            onPrioritizeDrama={handlePrioritizeDrama}
            onSelectDrama={handleSelectDrama}
            onClearLogs={handleClearLogs}
            onSortChange={setSortOption}
            onProviderFilterChange={setTableProviderFilter}
            selectedTableProvider={tableProviderFilter}
            onRefreshAllData={handleRefreshAllData}
            loadingAction={loadingAction}
          />
        )}
      </main>

      {/* 🎬 Episode Inspector & Granular Sync Control Modal */}
      {selectedDramaDetail && (
        <EpisodeInspectorModal
          drama={selectedDramaDetail}
          initialEpisodes={selectedDramaEpisodes}
          onClose={() => setSelectedDramaDetail(null)}
          onRefreshData={handleRefreshAllData}
        />
      )}
    </div>
  );
}
