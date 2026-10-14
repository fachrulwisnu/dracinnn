import React from 'react';

/**
 * Image URL resolver with wsrv.nl WebP conversion proxy for HEIC / fizzopic.org / TikTok CDN images
 */
export function resolveCoverUrl(url?: string | null): string {
  if (!url || typeof url !== 'string' || !url.trim()) {
    return 'https://placehold.co/400x600/1e293b/cbd5e1?text=No+Cover';
  }

  const cleanUrl = url.trim();

  // If already data URI or blob, return as is
  if (cleanUrl.startsWith('data:') || cleanUrl.startsWith('blob:')) {
    return cleanUrl;
  }

  // If local fallback image
  if (cleanUrl.includes('placehold.co')) {
    return cleanUrl;
  }

  const isHeic = cleanUrl.toLowerCase().includes('.heic');
  const isFizzopic = cleanUrl.toLowerCase().includes('fizzopic.org');
  const isTikTokCdn = cleanUrl.toLowerCase().includes('tiktokcdn.com');

  // HEIC or fizzopic CDN requires wsrv.nl WebP conversion proxy for Chrome/Edge/Firefox rendering
  if (isHeic || isFizzopic) {
    return `https://wsrv.nl/?url=${encodeURIComponent(cleanUrl)}&output=webp&q=85`;
  }

  if (isTikTokCdn) {
    return `https://wsrv.nl/?url=${encodeURIComponent(cleanUrl)}&output=webp&q=85`;
  }

  return cleanUrl;
}

/**
 * Multi-tier image onError handler
 */
export function handleImageError(
  e: React.SyntheticEvent<HTMLImageElement, Event>,
  originalUrl?: string
) {
  const img = e.currentTarget;
  const currentSrc = img.src || '';

  // Tier 1: Try backend image proxy if wsrv.nl proxy failed
  if (originalUrl && !currentSrc.includes('/api/proxy-image') && !img.dataset.triedBackendProxy) {
    img.dataset.triedBackendProxy = 'true';
    img.src = `/api/proxy-image?url=${encodeURIComponent(originalUrl)}`;
    return;
  }

  // Tier 2: Try replacing .heic with .jpeg
  if (originalUrl && originalUrl.toLowerCase().includes('.heic') && !img.dataset.triedHeicReplace) {
    img.dataset.triedHeicReplace = 'true';
    const replaced = originalUrl.replace(/\.heic/gi, '.jpeg');
    img.src = `https://wsrv.nl/?url=${encodeURIComponent(replaced)}&output=webp&q=85`;
    return;
  }

  // Tier 3: Placeholder image fallback
  img.src = 'https://placehold.co/400x600/1e293b/cbd5e1?text=No+Cover';
}
