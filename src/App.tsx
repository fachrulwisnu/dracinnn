import React, { useEffect, useState, useCallback } from 'react';
import { Header } from './components/Header';
import { SyncControlCenter } from './components/SyncControlCenter';
import { PineDramaPortal } from './components/PineDramaPortal';
import { VideoPlayerModal } from './components/VideoPlayerModal';

export default function App() {
  const [activeTab, setActiveTab] = useState<'portal' | 'sync'>('portal');
  const [categories, setCategories] = useState<any[]>([]);
  const [dramas, setDramas] = useState<any[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [sortOption, setSortOption] = useState<string>('importedAt_desc');

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

  // Video Modal State
  const [selectedDramaDetail, setSelectedDramaDetail] = useState<any | null>(null);
  const [selectedDramaEpisodes, setSelectedDramaEpisodes] = useState<any[]>([]);

  // Fetch Sync Status
  const fetchSyncStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/sync/status');
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
  }, []);

  // Fetch Categories
  const fetchCategories = useCallback(async () => {
    try {
      const res = await fetch('/api/categories');
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setCategories(data.categories || []);
        }
      }
    } catch (err) {
      console.error('Error fetching categories:', err);
    }
  }, []);

  // Fetch Dramas
  const fetchDramas = useCallback(async () => {
    try {
      const url = new URL('/api/dramas', window.location.origin);
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
  }, [selectedCategory, searchQuery, sortOption]);

  // Initial load
  useEffect(() => {
    fetchCategories();
    fetchDramas();
    fetchSyncStatus();
  }, [fetchCategories, fetchDramas, fetchSyncStatus]);

  // Polling sync status every 3s
  useEffect(() => {
    const interval = setInterval(() => {
      fetchSyncStatus();
      fetchDramas();
    }, 3000);
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

  // Open Video Drawer for a Drama
  const handleSelectDrama = async (dramaId: string) => {
    try {
      const res = await fetch(`/api/dramas/${dramaId}`);
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

  // On-demand episode fetch callback
  const handleFetchOnDemand = async (dramaId: string, epNum: number): Promise<string> => {
    const res = await fetch(`/api/episodes/${dramaId}/${epNum}/stream`);
    const data = await res.json();
    if (!res.ok || !data.success || !data.streamUrl) {
      throw new Error(data.error || 'Stream URL unavailable');
    }

    handleSelectDrama(dramaId);
    return data.streamUrl;
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
        {activeTab === 'portal' ? (
          <PineDramaPortal
            categories={categories}
            dramas={dramas}
            selectedCategory={selectedCategory}
            onSelectCategory={setSelectedCategory}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            onSelectDrama={handleSelectDrama}
          />
        ) : (
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
            onRefreshAllData={handleRefreshAllData}
            loadingAction={loadingAction}
          />
        )}
      </main>

      {/* Video Player Modal */}
      {selectedDramaDetail && (
        <VideoPlayerModal
          drama={selectedDramaDetail}
          episodes={selectedDramaEpisodes}
          onClose={() => setSelectedDramaDetail(null)}
          onFetchOnDemand={handleFetchOnDemand}
        />
      )}
    </div>
  );
}
