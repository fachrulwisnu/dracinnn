import React, { useState } from 'react';
import { Search, Film, CheckCircle2, Clock, Play, Sparkles, Filter } from 'lucide-react';

interface CategoryItem {
  categoryId: string;
  name: string;
  totalTitles: number;
}

interface DramaItem {
  dramaId: string;
  title: string;
  coverUrl: string;
  synopsis: string;
  categories: string[];
  totalEpisodes: number;
  syncedEpisodesCount: number;
  pendingEpisodesCount: number;
  syncStatus: string;
}

interface PineDramaPortalProps {
  categories: CategoryItem[];
  dramas: DramaItem[];
  selectedCategory: string;
  onSelectCategory: (categoryId: string) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onSelectDrama: (dramaId: string) => void;
}

export const PineDramaPortal: React.FC<PineDramaPortalProps> = ({
  categories,
  dramas,
  selectedCategory,
  onSelectCategory,
  searchQuery,
  onSearchChange,
  onSelectDrama,
}) => {
  return (
    <div className="min-h-screen text-slate-100 p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-8">
      {/* Hero Banner / Header Section */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-slate-900 to-amber-950/60 border border-slate-800 p-6 sm:p-10 shadow-2xl">
        <div className="relative z-10 max-w-2xl space-y-4">
          <div className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-amber-400 bg-amber-500/10 px-3 py-1 rounded-full border border-amber-500/20">
            <Sparkles className="w-3.5 h-3.5" />
            <span>PineDrama Short Drama Streaming</span>
          </div>

          <h1 className="text-3xl sm:text-5xl font-black text-white tracking-tight leading-tight">
            Watch Trending Short Dramas <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-400 to-rose-400">Instantly</span>
          </h1>

          <p className="text-slate-300 text-sm sm:text-base leading-relaxed">
            Stream Chinese short dramas synced directly from PineDrama. High speed 9:16 vertical video player with automated background stream fetching.
          </p>

          {/* Search Input Bar */}
          <div className="relative pt-2">
            <div className="relative flex items-center">
              <Search className="absolute left-4 w-5 h-5 text-slate-400" />
              <input
                type="text"
                placeholder="Search drama title or keywords..."
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                className="w-full bg-slate-950/90 border border-slate-700/80 rounded-2xl pl-12 pr-4 py-3.5 text-sm text-white placeholder-slate-400 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 shadow-xl transition-all"
              />
            </div>
          </div>
        </div>

        {/* Decorative background blur */}
        <div className="absolute -right-12 -bottom-12 w-96 h-96 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />
      </div>

      {/* Category Filter Buttons */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-400">
          <Filter className="w-4 h-4 text-amber-400" />
          <span>Categories</span>
        </div>

        <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-none">
          <button
            onClick={() => onSelectCategory('all')}
            className={`px-4 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
              selectedCategory === 'all'
                ? 'bg-amber-500 text-slate-950 shadow-lg shadow-amber-500/20'
                : 'bg-slate-900 border border-slate-800 text-slate-300 hover:bg-slate-800'
            }`}
          >
            All Categories
          </button>

          {categories.map((cat, idx) => (
            <button
              key={`${(cat as any).provider || "pine"}-${cat.categoryId || idx}-${idx}`}
              onClick={() => onSelectCategory(cat.categoryId)}
              className={`px-4 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                selectedCategory === cat.categoryId
                  ? 'bg-amber-500 text-slate-950 shadow-lg shadow-amber-500/20'
                  : 'bg-slate-900 border border-slate-800 text-slate-300 hover:bg-slate-800'
              }`}
            >
              {cat.name} ({cat.totalTitles})
            </button>
          ))}
        </div>
      </div>

      {/* Drama Grid */}
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-xl font-black text-white flex items-center gap-2">
            <Film className="w-5 h-5 text-amber-400" />
            Catalog Dramas ({dramas.length})
          </h2>
        </div>

        {dramas.length === 0 ? (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-12 text-center space-y-4">
            <Film className="w-12 h-12 text-slate-600 mx-auto" />
            <div className="text-slate-300 font-bold text-lg">No Dramas Found</div>
            <p className="text-sm text-slate-400 max-w-md mx-auto">
              No dramas match your search or filter criteria. Try changing categories or click "1. Get Categories &amp; Titles" in the Sync Control Center tab to pull PineDrama titles!
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 sm:gap-6">
            {dramas.map((drama) => {
              const readyEps = drama.syncedEpisodesCount || 0;
              const pendingEps = drama.pendingEpisodesCount || 0;
              const targetId = (drama as any).book_id || (drama as any).collection_id || (drama as any).series_id_str || drama.dramaId || (drama as any)._id || (drama as any).id;

              return (
                <div
                  key={targetId || drama.title}
                  onClick={() => targetId && onSelectDrama(targetId)}
                  className="group relative bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-lg hover:border-amber-500/50 hover:shadow-2xl hover:shadow-amber-500/10 transition-all duration-300 flex flex-col cursor-pointer"
                >
                  {/* Poster Image (Aspect Ratio 3:4) */}
                  <div className="relative aspect-[3/4] bg-slate-950 overflow-hidden">
                    <img
                      src={drama.coverUrl || 'https://via.placeholder.com/300x400'}
                      alt={drama.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                      referrerPolicy="no-referrer"
                      onError={(e) => {
                        (e.target as HTMLElement).style.display = 'none';
                      }}
                    />

                    <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/20 to-transparent opacity-80" />

                    {/* Play Hover Overlay Button */}
                    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-slate-950/40">
                      <div className="w-12 h-12 rounded-full bg-amber-500 text-slate-950 flex items-center justify-center shadow-xl transform scale-90 group-hover:scale-100 transition-transform">
                        <Play className="w-6 h-6 fill-current ml-0.5" />
                      </div>
                    </div>

                    {/* Ready vs Pending Badge */}
                    <div className="absolute top-2 right-2 flex flex-col gap-1 items-end">
                      <span className="px-2 py-0.5 rounded-md bg-slate-950/90 text-emerald-400 border border-emerald-500/30 text-[10px] font-mono font-bold backdrop-blur-md">
                        Ready: {readyEps}
                      </span>
                      {pendingEps > 0 && (
                        <span className="px-2 py-0.5 rounded-md bg-slate-950/90 text-amber-400 border border-amber-500/30 text-[10px] font-mono font-bold backdrop-blur-md">
                          Pending: {pendingEps}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Card Content */}
                  <div className="p-3.5 flex-1 flex flex-col justify-between space-y-2">
                    <div>
                      <h3 className="font-bold text-sm text-white line-clamp-2 group-hover:text-amber-400 transition-colors">
                        {drama.title}
                      </h3>
                      {/* Unboxed Metadata text separation */}
                      <div className="text-xs text-slate-400 mt-1 flex items-center gap-1.5 flex-wrap">
                        <span>{drama.categories?.slice(0, 1).join('') || 'Drama'}</span>
                        <span aria-hidden="true">·</span>
                        <span>{drama.totalEpisodes} Eps</span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
