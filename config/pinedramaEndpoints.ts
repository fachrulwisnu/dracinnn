/**
 * Configuration and Swagger/OpenAPI endpoint discovery for PineDrama on Sansekai API
 */

export const DEFAULT_PINEDRAMA_CONFIG = {
  baseUrl: process.env.SANSEKAI_BASE_URL || 'https://api.sansekai.my.id/api',
  swaggerUrl: 'https://api.sansekai.my.id/swagger.json',
  rateLimitMs: 6500, // 6.5s delay to strictly comply with <=10 requests/minute
  cooldownOn429Ms: 65000, // 65s cooldown if 429 encountered
  defaultLang: 'id',
  endpoints: {
    forYou: '/pinedrama/foryou',
    trending: '/pinedrama/trending',
    search: '/pinedrama/search',
    detail: '/pinedrama/detail',
    getEpisode: '/pinedrama/get-episode',
  },
};

export async function discoverEndpoints(): Promise<typeof DEFAULT_PINEDRAMA_CONFIG.endpoints> {
  try {
    const res = await fetch(DEFAULT_PINEDRAMA_CONFIG.swaggerUrl);
    if (res.ok) {
      const swagger = await res.json();
      const paths = swagger.paths || {};
      const found: Partial<typeof DEFAULT_PINEDRAMA_CONFIG.endpoints> = {};

      for (const pathKey of Object.keys(paths)) {
        if (pathKey.includes('foryou')) found.forYou = pathKey;
        if (pathKey.includes('trending')) found.trending = pathKey;
        if (pathKey.includes('search')) found.search = pathKey;
        if (pathKey.includes('detail')) found.detail = pathKey;
        if (pathKey.includes('get-episode')) found.getEpisode = pathKey;
      }

      return {
        ...DEFAULT_PINEDRAMA_CONFIG.endpoints,
        ...found,
      };
    }
  } catch (err) {
    console.warn('[Endpoint Discovery] Falling back to default PineDrama endpoints:', (err as Error).message);
  }
  return DEFAULT_PINEDRAMA_CONFIG.endpoints;
}
