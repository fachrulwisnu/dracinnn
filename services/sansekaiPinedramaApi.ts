import axios, { AxiosInstance, AxiosError } from 'axios';
import { DEFAULT_PINEDRAMA_CONFIG } from '../config/pinedramaEndpoints.js';

export interface SansekaiCollectionItem {
  collection_id: string;
  title: string;
  description?: string | null;
  total_episodes?: number;
  views?: number;
  categories?: string;
  tags?: string[];
  cover?: string;
  is_limited_free?: boolean;
  label_hot?: boolean;
  label_new?: boolean;
}

export interface ParsedEpisodeData {
  episode_num: number;
  video_id: string | null;
  title: string;
  best_url: string | null;
  quality: string | null;
  backup_urls: string[];
  raw: any;
  error?: string | null;
}

/**
 * Parse exact Sansekai /get-episode response structure
 */
export function parseEpisodeResponse(data: any, fallbackEpNum: number = 1): ParsedEpisodeData {
  if (!data) {
    return {
      episode_num: fallbackEpNum,
      video_id: null,
      title: `Episode ${fallbackEpNum}`,
      best_url: null,
      quality: null,
      backup_urls: [],
      raw: null,
      error: 'Empty response data',
    };
  }

  const episodeNum = data.episode_num || data.episodeNumber || fallbackEpNum;
  const videoId = data.video_id || null;
  const title = data.title || data.main?.desc || data.alt?.desc || `Episode ${episodeNum}`;
  const quality = data.quality || 'HD_INDO';

  // Extract all CDN URLs
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

  collect(data.alt?.indo_hd_cdn_urls);
  collect(data.main?.indo_hd_cdn_urls);
  collect(data.alt?.indo_cdn_urls);
  collect(data.main?.indo_cdn_urls);
  collect(data.alt?.cdn_urls);
  collect(data.main?.cdn_urls);

  if (data.best_url && typeof data.best_url === 'string' && data.best_url.startsWith('http')) {
    if (!allUrls.includes(data.best_url)) {
      allUrls.unshift(data.best_url);
    }
  }

  const bestUrl = data.best_url || allUrls[0] || null;

  return {
    episode_num: episodeNum,
    video_id: videoId,
    title,
    best_url: bestUrl,
    quality,
    backup_urls: allUrls,
    raw: data,
    error: data.error || (bestUrl ? null : 'No stream URL returned'),
  };
}

export class SansekaiPinedramaApi {
  private client: AxiosInstance;
  public endpoints = { ...DEFAULT_PINEDRAMA_CONFIG.endpoints };

  constructor() {
    this.client = axios.create({
      baseURL: DEFAULT_PINEDRAMA_CONFIG.baseUrl,
      timeout: 30000,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        Accept: 'application/json, text/plain, */*',
        'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
        Referer: 'https://api.sansekai.my.id/',
        Origin: 'https://api.sansekai.my.id',
        'Sec-Ch-Ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
      },
    });
  }

  public formatError(error: any): { message: string; status?: number; fullUrl?: string; dataSnippet?: string } {
    if (axios.isAxiosError(error)) {
      const axiosErr = error as AxiosError;
      const status = axiosErr.response?.status;
      const fullUrl = axiosErr.config ? `${axiosErr.config.baseURL || ''}${axiosErr.config.url || ''}` : '';
      let dataSnippet = '';

      if (axiosErr.response?.data) {
        if (typeof axiosErr.response.data === 'string') {
          dataSnippet = axiosErr.response.data.slice(0, 200).replace(/\s+/g, ' ');
        } else {
          dataSnippet = JSON.stringify(axiosErr.response.data).slice(0, 200);
        }
      }

      return {
        message: `HTTP ${status || 'Error'} requesting ${fullUrl} ${dataSnippet ? `| Body: ${dataSnippet}` : ''}`,
        status,
        fullUrl,
        dataSnippet,
      };
    }
    return { message: (error as Error).message || 'Unknown error' };
  }

  async getForYou(cursor: string = '1', lang: string = 'id', customEndpoint?: string) {
    const ep = customEndpoint || this.endpoints.forYou;
    const response = await this.client.get(ep, { params: { cursor, lang } });
    return response.data;
  }

  async getTrending(cursor: string = '1', lang: string = 'id', customEndpoint?: string) {
    const ep = customEndpoint || this.endpoints.trending;
    const response = await this.client.get(ep, { params: { cursor, lang } });
    return response.data;
  }

  async search(query: string, lang: string = 'id', customEndpoint?: string) {
    const ep = customEndpoint || this.endpoints.search;
    const response = await this.client.get(ep, { params: { query, lang } });
    return response.data;
  }

  async getDetail(collectionId: string, lang: string = 'id', customEndpoint?: string) {
    const ep = customEndpoint || this.endpoints.detail;
    const response = await this.client.get(ep, { params: { collection_id: collectionId, lang } });
    return response.data;
  }

  async getEpisode(collectionId: string, episodeNumber: number, lang: string = 'id', customEndpoint?: string) {
    const ep = customEndpoint || this.endpoints.getEpisode;
    const response = await this.client.get(ep, {
      params: {
        collection_id: collectionId,
        episodeNumber,
        lang,
      },
    });

    const parsed = parseEpisodeResponse(response.data, episodeNumber);
    return {
      raw: response.data,
      streamUrl: parsed.best_url,
      bestUrl: parsed.best_url,
      videoId: parsed.video_id,
      title: parsed.title,
      quality: parsed.quality,
      backupUrls: parsed.backup_urls,
      error: parsed.error,
    };
  }

  async testEndpoint(endpointPath: string, params: Record<string, any> = {}) {
    const response = await this.client.get(endpointPath, { params });
    return {
      status: response.status,
      headers: response.headers,
      data: response.data,
      url: response.config.url,
      fullUrl: `${this.client.defaults.baseURL}${response.config.url}`,
    };
  }
}

export const sansekaiApi = new SansekaiPinedramaApi();
