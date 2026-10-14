/**
 * Universal Provider Adapter & Normalizer for PineDrama + Melolo + Extensible Providers
 */

export interface NormalizedDramaItem {
  provider: 'pinedrama' | 'melolo' | string;
  collection_id: string;
  title: string;
  coverUrl: string;
  synopsis: string;
  categories: string[];
  totalEpisodes: number;
  source: string;
  raw?: any;
  video_list?: any[]; // For Melolo when episode list is returned in detail
}

export interface NormalizedEpisodeData {
  provider: 'pinedrama' | 'melolo' | string;
  episode_num: number;
  video_id: string | null;
  title: string;
  best_url: string | null;
  quality: string | null;
  backup_urls: string[];
  raw?: any;
  error?: string | null;
}

/**
 * Universal Deep Array Extractor for Melolo & PineDrama API Responses
 */
export function extractDramaItemsFromResponse(rawJson: any): any[] {
  if (!rawJson) return [];
  if (Array.isArray(rawJson)) return rawJson;

  const directCandidates = [
    rawJson.data?.books,
    rawJson.data?.data,
    rawJson.data?.list,
    rawJson.data?.video_list,
    rawJson.data?.items,
    rawJson.data?.series_list,
    rawJson.data?.recommend_list,
    rawJson.data?.category_list,
    rawJson.data?.results,
    rawJson.data?.search_data,
    rawJson.data?.cell?.books,
    rawJson.data?.video_data?.video_list,
    rawJson.data,
    rawJson.books,
    rawJson.items,
    rawJson.list,
    rawJson.video_list,
    rawJson.results,
    rawJson.dramas,
    rawJson.collections,
  ];

  for (const candidate of directCandidates) {
    if (Array.isArray(candidate) && candidate.length > 0) {
      if (candidate[0]?.books && Array.isArray(candidate[0].books)) {
        return candidate.flatMap((group: any) => group.books || []);
      }
      return candidate;
    }
  }

  const foundDramas: any[] = [];
  const seenIds = new Set<string>();

  const walk = (obj: any) => {
    if (!obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) {
      obj.forEach(walk);
      return;
    }
    const id = obj.collection_id || obj.series_id_str || obj.book_id || obj.series_id || obj.id || obj.category_id || obj.categoryId;
    const title = obj.title || obj.series_title || obj.book_name || obj.name || obj.category_name;
    if (id && title && typeof title === 'string') {
      const strId = String(id);
      if (!seenIds.has(strId)) {
        seenIds.add(strId);
        foundDramas.push(obj);
      }
    }
    Object.values(obj).forEach(walk);
  };

  walk(rawJson);
  return foundDramas;
}

/**
 * Extract book objects recursively from Melolo response structures
 */
export function extractMeloloBooks(data: any): any[] {
  return extractDramaItemsFromResponse(data);
}

/**
 * Normalizer specifically for Melolo Detail endpoint response
 * (`GET /api/melolo/detail?book_id=...&lang=id`)
 */
export function normalizeMeloloDetail(rawResponse: any, defaultSource = 'Melolo Detail'): NormalizedDramaItem {
  const videoData = rawResponse?.data?.video_data || rawResponse?.video_data || rawResponse;

  const collection_id = String(
    videoData?.series_id_str ||
    videoData?.book_id ||
    videoData?.series_id ||
    rawResponse?.book_id ||
    ''
  );

  const title =
    videoData?.series_title ||
    videoData?.book_name ||
    videoData?.title ||
    videoData?.name ||
    `Melolo Drama ${collection_id}`;

  let coverUrl =
    videoData?.series_cover ||
    videoData?.thumb_url ||
    videoData?.cover_url ||
    videoData?.first_chapter_cover ||
    videoData?.video_list?.[0]?.cover ||
    videoData?.video_list?.[0]?.episode_cover ||
    '';

  const synopsis = videoData?.series_intro || videoData?.abstract || videoData?.description || videoData?.sub_abstract || '';

  let totalEpisodes = parseInt(
    videoData?.episode_cnt ||
    videoData?.video_list?.length ||
    videoData?.serial_count ||
    '61',
    10
  );
  if (isNaN(totalEpisodes) || totalEpisodes <= 0) totalEpisodes = 61;

  // Extract categories strictly from category_schema, category_info, or stat_infos
  let categories: string[] = [];

  if (videoData?.category_schema) {
    try {
      const parsed = typeof videoData.category_schema === 'string'
        ? JSON.parse(videoData.category_schema)
        : videoData.category_schema;
      if (Array.isArray(parsed)) {
        categories = parsed.map((c: any) => c.name || c.Name).filter(Boolean);
      }
    } catch (e) {}
  }

  if (categories.length === 0 && videoData?.category_info) {
    try {
      const parsed = typeof videoData.category_info === 'string'
        ? JSON.parse(videoData.category_info)
        : videoData.category_info;
      if (Array.isArray(parsed)) {
        categories = parsed.map((c: any) => c.Name || c.name).filter(Boolean);
      }
    } catch (e) {}
  }

  if (categories.length === 0 && Array.isArray(videoData?.stat_infos) && videoData.stat_infos.length > 0) {
    categories = videoData.stat_infos.filter(Boolean);
  }

  if (categories.length === 0) {
    categories = ['Romansa Urban'];
  }

  // Extract video_list (all episodes with vid)
  const rawList = Array.isArray(videoData?.video_list) ? videoData.video_list : [];
  const video_list = rawList.map((item: any, idx: number) => {
    const epNum = parseInt(item.vid_index || item.episode_num || idx + 1, 10);
    const vid = String(item.vid || item.video_id || item.video_id_str || '');
    const epCover = item.cover || item.episode_cover || coverUrl || '';
    const duration = item.duration || 0;
    const epTitle = item.title || `Episode ${epNum}`;

    return {
      episodeNumber: epNum,
      video_id: vid,
      title: epTitle,
      cover: epCover,
      duration,
      disclaimer: item.disclaimer_info?.content || null,
      raw: item,
    };
  });

  return {
    provider: 'melolo',
    collection_id,
    title,
    coverUrl,
    synopsis,
    categories: Array.from(new Set(categories)),
    totalEpisodes,
    source: defaultSource,
    video_list,
    raw: rawResponse,
  };
}

/**
 * Universal Normalizer for Drama / Collection item
 */
export function normalizeDramaItem(item: any, provider: 'pinedrama' | 'melolo' = 'pinedrama', defaultSource = ''): NormalizedDramaItem {
  if (provider === 'melolo') {
    if (item.video_data || item.data?.video_data) {
      return normalizeMeloloDetail(item, defaultSource);
    }

    const cid = String(item.series_id_str || item.book_id || item.series_id || item.collection_id || item.id || '');
    const title = item.series_title || item.book_name || item.title || item.name || `Melolo Drama ${cid}`;
    const cover = item.series_cover || item.thumb_url || item.first_chapter_cover || item.cover_url || item.cover || item.video_list?.[0]?.cover || '';
    const synopsis = item.series_intro || item.abstract || item.description || item.sub_abstract || '';

    let totalEps = parseInt(item.episode_cnt || item.serial_count || item.last_chapter_index || item.total_episodes || '30', 10);
    if (isNaN(totalEps) || totalEps <= 0) totalEps = 30;

    let cats: string[] = [];

    if (item.category_schema) {
      try {
        const parsedSchema = typeof item.category_schema === 'string' ? JSON.parse(item.category_schema) : item.category_schema;
        if (Array.isArray(parsedSchema)) {
          cats = parsedSchema.map((c: any) => c.name || c.Name).filter(Boolean);
        }
      } catch (e) {}
    }

    if (cats.length === 0 && item.category_info) {
      try {
        const parsedInfo = typeof item.category_info === 'string' ? JSON.parse(item.category_info) : item.category_info;
        if (Array.isArray(parsedInfo)) {
          cats = parsedInfo.map((c: any) => c.Name || c.name).filter(Boolean);
        }
      } catch (e) {}
    }

    if (cats.length === 0 && Array.isArray(item.stat_infos) && item.stat_infos.length > 0) {
      cats = item.stat_infos;
    }

    if (cats.length === 0) cats = ['Melolo Short Drama'];

    return {
      provider: 'melolo',
      collection_id: cid,
      title,
      coverUrl: cover,
      synopsis,
      categories: Array.from(new Set(cats)),
      totalEpisodes: totalEps,
      source: item.source || defaultSource || 'Melolo Discovery',
      raw: item,
      video_list: item.video_list || [],
    };
  } else {
    // PineDrama Normalization
    const cid = String(item.collection_id || item.series_id_str || item.book_id || item.id || '');
    const title = item.title || item.series_title || item.book_name || `PineDrama ${cid}`;
    const cover = item.cover || item.coverUrl || item.series_cover || '';
    const synopsis = item.description || item.synopsis || item.series_intro || '';
    let totalEps = item.total_episodes || item.totalEpisodes || item.episode_cnt || 30;

    let cats: string[] = [];
    if (typeof item.categories === 'string') {
      cats = item.categories.split(',').map((c: string) => c.trim()).filter(Boolean);
    } else if (Array.isArray(item.tags)) {
      cats = item.tags;
    }
    if (cats.length === 0) cats = ['General'];

    return {
      provider: 'pinedrama',
      collection_id: cid,
      title,
      coverUrl: cover,
      synopsis,
      categories: Array.from(new Set(cats)),
      totalEpisodes: totalEps,
      source: item.source || defaultSource || 'PineDrama Discovery',
      raw: item,
    };
  }
}

/**
 * Universal Normalizer for Episode Stream Response
 */
export function normalizeEpisodeResponse(data: any, provider: 'pinedrama' | 'melolo' = 'pinedrama', fallbackEpNum: number = 1): NormalizedEpisodeData {
  if (provider === 'melolo') {
    if (!data) {
      return {
        provider: 'melolo',
        episode_num: fallbackEpNum,
        video_id: null,
        title: `Episode ${fallbackEpNum}`,
        best_url: null,
        quality: null,
        backup_urls: [],
        error: 'Empty Melolo episode response',
      };
    }

    const videoId = data.videoId || data.video_id || null;
    const quality = data.definition || '720p';
    const bestUrl = data.streamUrl || null;

    const backupUrls: string[] = [];
    if (Array.isArray(data.qualities)) {
      data.qualities.forEach((q: any) => {
        if (q.streamUrl && typeof q.streamUrl === 'string' && q.streamUrl.startsWith('http') && !backupUrls.includes(q.streamUrl)) {
          backupUrls.push(q.streamUrl);
        }
      });
    }
    if (bestUrl && !backupUrls.includes(bestUrl)) {
      backupUrls.unshift(bestUrl);
    }

    return {
      provider: 'melolo',
      episode_num: fallbackEpNum,
      video_id: videoId,
      title: `Episode ${fallbackEpNum}`,
      best_url: bestUrl,
      quality,
      backup_urls: backupUrls,
      raw: data,
      error: bestUrl ? null : 'No stream URL returned in Melolo response',
    };
  } else {
    // PineDrama Episode Parsing
    const episodeNum = data?.episode_num || data?.episodeNumber || fallbackEpNum;
    const videoId = data?.video_id || null;
    const title = data?.title || data?.main?.desc || data?.alt?.desc || `Episode ${episodeNum}`;
    const quality = data?.quality || 'HD_INDO';

    const allUrls: string[] = [];
    const collect = (arr: any) => {
      if (Array.isArray(arr)) {
        arr.forEach((u) => {
          if (typeof u === 'string' && u.startsWith('http') && !allUrls.includes(u)) {
            allUrls.push(u);
          }
        });
      }
    };

    collect(data?.alt?.indo_hd_cdn_urls);
    collect(data?.main?.indo_hd_cdn_urls);
    collect(data?.alt?.indo_cdn_urls);
    collect(data?.main?.indo_cdn_urls);

    if (data?.best_url && !allUrls.includes(data.best_url)) {
      allUrls.unshift(data.best_url);
    }

    const bestUrl = data?.best_url || allUrls[0] || null;

    return {
      provider: 'pinedrama',
      episode_num: episodeNum,
      video_id: videoId,
      title,
      best_url: bestUrl,
      quality,
      backup_urls: allUrls,
      raw: data,
      error: data?.error || (bestUrl ? null : 'No stream URL returned in PineDrama response'),
    };
  }
}

export function parseEpisodeResponse(data: any, fallbackEpNum: number = 1): NormalizedEpisodeData {
  return normalizeEpisodeResponse(data, 'pinedrama', fallbackEpNum);
}
