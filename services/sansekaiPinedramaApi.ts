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
 * Generate random public IPv4 addresses for header spoofing (Indonesian ISP & global IP pools)
 */
export function generateRandomIp(): string {
  const ipPrefixes = [
    '36.68', '36.72', '36.85', '114.122', '114.124', '114.125',
    '180.241', '180.252', '103.28', '103.10', '202.152', '110.138',
    '125.160', '139.192', '140.213', '175.158', '112.215', '203.190',
    '45.112', '103.147', '182.253', '27.105', '118.99'
  ];
  const prefix = ipPrefixes[Math.floor(Math.random() * ipPrefixes.length)];
  const b3 = Math.floor(Math.random() * 254) + 1;
  const b4 = Math.floor(Math.random() * 254) + 1;
  return `${prefix}.${b3}.${b4}`;
}

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_3_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0',
  'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.6261.64 Mobile Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_3_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Edg/122.0.0.0'
];

export interface ProxyStrategy {
  id: string;
  name: string;
  type: 'direct_spoof' | 'cors_proxy';
  buildUrl: (targetUrl: string) => string;
  successCount: number;
  failCount: number;
  lastUsedAt?: string;
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
  public endpoints = { ...DEFAULT_PINEDRAMA_CONFIG.endpoints };
  private activeStrategyIndex = 0;
  private totalBypassedBlacklists = 0;

  private strategies: ProxyStrategy[] = [
    {
      id: 'strategy_a_spoof',
      name: 'Strategy A: Direct Browser-like Headers & Spoofed IP',
      type: 'direct_spoof',
      buildUrl: (url) => url,
      successCount: 0,
      failCount: 0,
    },
    {
      id: 'strategy_b1_corsproxy',
      name: 'Strategy B1: CorsProxy.io Gateway',
      type: 'cors_proxy',
      buildUrl: (url) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
      successCount: 0,
      failCount: 0,
    },
    {
      id: 'strategy_b2_allorigins',
      name: 'Strategy B2: AllOrigins Mirror Gateway',
      type: 'cors_proxy',
      buildUrl: (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
      successCount: 0,
      failCount: 0,
    },
    {
      id: 'strategy_b3_codetabs',
      name: 'Strategy B3: CodeTabs Proxy Gateway',
      type: 'cors_proxy',
      buildUrl: (url) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
      successCount: 0,
      failCount: 0,
    },
    {
      id: 'strategy_b4_thingproxy',
      name: 'Strategy B4: ThingProxy Gateway',
      type: 'cors_proxy',
      buildUrl: (url) => `https://thingproxy.freeboard.io/fetch/${url}`,
      successCount: 0,
      failCount: 0,
    },
  ];

  /**
   * Helper to construct intelligent spoofed headers
   */
  public generateSpoofedHeaders(): Record<string, string> {
    const randomIp = generateRandomIp();
    const randomUa = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

    return {
      'User-Agent': randomUa,
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
      'Referer': 'https://api.sansekai.my.id/',
      'Origin': 'https://api.sansekai.my.id',
      'X-Forwarded-For': randomIp,
      'X-Real-IP': randomIp,
      'CF-Connecting-IP': randomIp,
      'Client-IP': randomIp,
      'True-Client-IP': randomIp,
      'Sec-Ch-Ua': '"Google Chrome";v="123", "Chromium";v="123", "Not:A-Brand";v="24"',
      'Sec-Ch-Ua-Mobile': '?0',
      'Sec-Ch-Ua-Platform': '"Windows"',
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-origin',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
    };
  }

  /**
   * Check if response data contains the Sansekai IP blacklist signature
   */
  private isBlacklistedResponse(status: number | undefined, data: any): boolean {
    if (status === 403) return true;
    if (data && typeof data === 'object') {
      const msg = (data.message || data.error || '').toString().toLowerCase();
      if (msg.includes('diblacklist') || msg.includes('forbidden') || msg.includes('aktivitas mencurigakan')) {
        return true;
      }
    }
    if (typeof data === 'string') {
      const lower = data.toLowerCase();
      if (lower.includes('diblacklist') || lower.includes('forbidden') || lower.includes('aktivitas mencurigakan')) {
        return true;
      }
    }
    return false;
  }

  /**
   * Request with automatic Multi-Strategy IP/Proxy & Header Rotation
   */
  public async requestWithRotation(endpointPath: string, params: Record<string, any> = {}): Promise<any> {
    const baseUrl = DEFAULT_PINEDRAMA_CONFIG.baseUrl;
    const cleanPath = endpointPath.startsWith('/') ? endpointPath : `/${endpointPath}`;
    
    // Construct target URL
    const queryString = new URLSearchParams(params).toString();
    const targetUrl = queryString ? `${baseUrl}${cleanPath}?${queryString}` : `${baseUrl}${cleanPath}`;

    let lastError: any = null;

    // Ordered strategy list starting from current activeStrategyIndex
    const strategyIndices: number[] = [];
    for (let i = 0; i < this.strategies.length; i++) {
      strategyIndices.push((this.activeStrategyIndex + i) % this.strategies.length);
    }

    for (const stratIdx of strategyIndices) {
      const strategy = this.strategies[stratIdx];
      const requestUrl = strategy.buildUrl(targetUrl);
      const headers = this.generateSpoofedHeaders();

      strategy.lastUsedAt = new Date().toISOString();

      try {
        const response = await axios.get(requestUrl, {
          headers,
          timeout: 20000,
          validateStatus: (status) => status < 500, // Handle 403 manually below
        });

        if (this.isBlacklistedResponse(response.status, response.data)) {
          strategy.failCount++;
          this.totalBypassedBlacklists++;
          console.warn(`[ProxyRotation] ${strategy.name} failed with 403 / IP Blacklist. Rotating to next strategy...`);
          lastError = new Error(`IP Blacklisted on ${strategy.name}`);
          continue;
        }

        if (response.status >= 400) {
          strategy.failCount++;
          console.warn(`[ProxyRotation] ${strategy.name} returned HTTP ${response.status}. Trying next strategy...`);
          lastError = new Error(`HTTP ${response.status} on ${strategy.name}`);
          continue;
        }

        // Success!
        strategy.successCount++;
        this.activeStrategyIndex = stratIdx; // Lock in working strategy as primary for subsequent calls
        return response.data;
      } catch (err: any) {
        strategy.failCount++;
        lastError = err;
        console.warn(`[ProxyRotation] ${strategy.name} failed with error: ${err.message}. Rotating...`);
      }
    }

    // If all strategies failed, throw the last encountered error
    throw lastError || new Error('All IP/Proxy rotation strategies failed to bypass API block.');
  }

  public getProxyStats() {
    return {
      activeStrategy: this.strategies[this.activeStrategyIndex]?.name || 'Unknown',
      totalBypassedBlacklists: this.totalBypassedBlacklists,
      strategies: this.strategies.map((s) => ({
        id: s.id,
        name: s.name,
        type: s.type,
        successCount: s.successCount,
        failCount: s.failCount,
        lastUsedAt: s.lastUsedAt || 'Never',
      })),
    };
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
    return await this.requestWithRotation(ep, { cursor, lang });
  }

  async getTrending(cursor: string = '1', lang: string = 'id', customEndpoint?: string) {
    const ep = customEndpoint || this.endpoints.trending;
    return await this.requestWithRotation(ep, { cursor, lang });
  }

  async search(query: string, lang: string = 'id', customEndpoint?: string) {
    const ep = customEndpoint || this.endpoints.search;
    return await this.requestWithRotation(ep, { query, lang });
  }

  async getDetail(collectionId: string, lang: string = 'id', customEndpoint?: string) {
    const ep = customEndpoint || this.endpoints.detail;
    return await this.requestWithRotation(ep, { collection_id: collectionId, lang });
  }

  async getEpisode(collectionId: string, episodeNumber: number, lang: string = 'id', customEndpoint?: string) {
    const ep = customEndpoint || this.endpoints.getEpisode;
    const rawData = await this.requestWithRotation(ep, {
      collection_id: collectionId,
      episodeNumber,
      lang,
    });

    const parsed = parseEpisodeResponse(rawData, episodeNumber);
    return {
      raw: rawData,
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
    const data = await this.requestWithRotation(endpointPath, params);
    return {
      status: 200,
      data,
      activeStrategy: this.strategies[this.activeStrategyIndex].name,
      proxyStats: this.getProxyStats(),
    };
  }
}

export const sansekaiApi = new SansekaiPinedramaApi();
