import React, { useState } from 'react';
import { Search, Film, CheckCircle2, Clock, Play, Sparkles, Filter, Layers } from 'lucide-react';
import { resolveCoverUrl, handleImageError } from '../utils/imageUtils';

interface CategoryItem {
  provider?: string;
  categoryId: string;
  name: string;
  totalTitles: number;
}

interface DramaItem {
  provider?: string;
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

interface DracinPortalProps {
  categories: CategoryItem[];
  dramas: DramaItem[];
  selectedProvider: string;
  onSelectProvider: (provider: string) => void;
  selectedCategory: string;
  onSelectCategory: (categoryId: string) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onSelectDrama: (dramaId: string) => void;
}

export const DracinPortal: React.FC<DracinPortalProps> = ({
  categories,
  dramas,
  selectedProvider,
  onSelectProvider,
  selectedCategory,
  onSelectCategory,
  searchQuery,
  onSearchChange,
  onSelectDrama,
}) => {
  return (
    <div className="min-h-screen text-slate-100 p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-8">
      {/* Hero Banner Section */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-slate-900 to-amber-950/60 border border-slate-800 p-6 sm:p-10 shadow-2xl">
        <div className="relative z-10 max-w-2xl space-y-4">
          <div className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-amber-400 bg-amber-500/10 px-3 py-1 rounded-full border border-amber-500/20">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Dracin Populer — Streaming Platform</span>
          </div>

          <h1 className="text-3xl sm:text-5xl font-black text-white tracking-tight leading-tight">
            Nonton Short Drama <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-400 via-rose-400 to-emerald-400">Multi-Provider</span>
          </h1>

          <p className="text-slate-300 text-sm sm:text-base leading-relaxed">
            Nonton drama pendek Mandarin dari provider 🌲 PineDrama &amp; 🍈 Melolo. Layar vertikal 9:16 dengan pemutar video TikTok CDN jernih.
          </p>

          {/* Search Bar */}
          <div className="relative pt-2">
            <div className="relative flex items-center">
              <Search className="absolute left-4 w-5 h-5 text-slate-400" />
              <input
                type="text"
                placeholder="Cari judul drama atau kata kunci..."
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                className="w-full bg-slate-950/90 border border-slate-700/80 rounded-2xl pl-12 pr-4 py-3.5 text-sm text-white placeholder-slate-400 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 shadow-xl transition-all"
              />
            </div>
          </div>
        </div>

        <div className="absolute -right-12 -bottom-12 w-96 h-96 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />
      </div>

      {/* Provider & Category Filter Section */}
      <div className="space-y-4 bg-slate-900/60 border border-slate-800 p-5 rounded-2xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-400">
            <Layers className="w-4 h-4 text-amber-400" />
            <span>Pilih Provider Drama:</span>
          </div>

          <div className="flex items-center gap-2 bg-slate-950 p-1 rounded-xl border border-slate-800">
            <button
              onClick={() => onSelectProvider('all')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                selectedProvider === 'all'
                  ? 'bg-amber-500 text-slate-950 shadow-md'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Semua Provider
            </button>

            <button
              onClick={() => onSelectProvider('pinedrama')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                selectedProvider === 'pinedrama'
                  ? 'bg-indigo-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              🌲 PineDrama
            </button>

            <button
              onClick={() => onSelectProvider('melolo')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                selectedProvider === 'melolo'
                  ? 'bg-emerald-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              🍈 Melolo
            </button>
          </div>
        </div>

        {/* Category Pills */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
          <button
            onClick={() => onSelectCategory('all')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
              selectedCategory === 'all'
                ? 'bg-amber-500 text-slate-950 shadow-md'
                : 'bg-slate-950 border border-slate-800 text-slate-300 hover:bg-slate-800'
            }`}
          >
            Semua Kategori
          </button>

          {categories.map((cat, idx) => (
            <button
              key={`${cat.provider || "gen"}-${cat.categoryId || idx}-${idx}`}
              onClick={() => onSelectCategory(cat.categoryId)}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                selectedCategory === cat.categoryId
                  ? 'bg-amber-500 text-slate-950 shadow-md'
                  : 'bg-slate-950 border border-slate-800 text-slate-300 hover:bg-slate-800'
              }`}
            >
              {cat.name} ({cat.totalTitles})
            </button>
          ))}
        </div>
      </div>

      {/* Drama Cards Grid */}
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-xl font-black text-white flex items-center gap-2">
            <Film className="w-5 h-5 text-amber-400" />
            Katalog Dracin Populer ({dramas.length})
          </h2>
        </div>

        {dramas.length === 0 ? (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-12 text-center space-y-4">
            <Film className="w-12 h-12 text-slate-600 mx-auto" />
            <div className="text-slate-300 font-bold text-lg">Tidak Ada Drama Ditemukan</div>
            <p className="text-sm text-slate-400 max-w-md mx-auto">
              Coba ganti kata kunci atau pilih provider lain. Anda juga bisa membuka tab Sync Control Center untuk menjelajahi dan mengimpor drama terbaru dari PineDrama / Melolo!
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 sm:gap-6">
            {dramas.map((drama) => {
              const readyEps = drama.syncedEpisodesCount || 0;
              const pendingEps = drama.pendingEpisodesCount || 0;
              const prov = drama.provider || 'pinedrama';

              return (
                <div
                  key={drama.dramaId}
                  onClick={() => onSelectDrama(drama.dramaId)}
                  className="group relative bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-lg hover:border-amber-500/50 hover:shadow-2xl hover:shadow-amber-500/10 transition-all duration-300 flex flex-col cursor-pointer"
                >
                  {/* Cover Poster */}
                  <div className="relative aspect-[3/4] bg-slate-950 overflow-hidden">
                    <img
                      src={resolveCoverUrl(drama.coverUrl)}
                      alt={drama.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                      referrerPolicy="no-referrer"
                      onError={(e) => handleImageError(e, drama.coverUrl)}
                    />

                    <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/20 to-transparent opacity-80" />

                    {/* Provider Badge */}
                    <div className="absolute top-2 left-2">
                      <span
                        className={`px-2 py-0.5 rounded-md text-[9px] font-bold tracking-wider uppercase border backdrop-blur-md ${
                          prov === 'melolo'
                            ? 'bg-emerald-950/90 text-emerald-300 border-emerald-500/40'
                            : 'bg-indigo-950/90 text-indigo-300 border-indigo-500/40'
                        }`}
                      >
                        {prov === 'melolo' ? '🍈 MELOLO' : '🌲 PINEDRAMA'}
                      </span>
                    </div>

                    {/* Play Button Overlay */}
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
