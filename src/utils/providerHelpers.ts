export interface EpisodeEndpointInfo {
  provider: 'melolo' | 'pinedrama';
  endpoint: string;
  hasVideoId: boolean;
  videoId?: string | null;
  collectionId?: string;
  epNum?: number;
}

/**
  Strict Provider Dispatcher for Browser Worker
  Guarantees that Melolo episodes ALWAYS map to Sansekai Melolo endpoints (`/api/melolo/get-episode?videoId=...`)
  and PineDrama episodes ALWAYS map to Sansekai PineDrama endpoints (`/api/pinedrama/get-episode?collection_id=...&episodeNumber=...`).
 */
export const resolveEpisodeEndpoint = (
  episode: {
    provider?: string;
    collection_id?: string;
    dramaId?: string;
    episodeNumber?: number;
    episode_number?: number;
    video_id?: string | null;
    videoId?: string | null;
    vid?: string | null;
  },
  drama?: {
    provider?: string;
    collection_id?: string;
    dramaId?: string;
  }
): EpisodeEndpointInfo => {
  const provider = (episode.provider || drama?.provider || 'pinedrama').toLowerCase();

  if (provider === 'melolo') {
    const videoId = episode.video_id || episode.videoId || episode.vid;
    const collectionId = episode.collection_id || episode.dramaId || drama?.collection_id || drama?.dramaId || '';

    if (videoId) {
      return {
        provider: 'melolo',
        endpoint: `https://api.sansekai.my.id/api/melolo/get-episode?videoId=${videoId}`,
        hasVideoId: true,
        videoId,
        collectionId,
      };
    } else {
      return {
        provider: 'melolo',
        endpoint: `https://api.sansekai.my.id/api/melolo/detail?book_id=${collectionId}&lang=id`,
        hasVideoId: false,
        collectionId,
      };
    }
  } else {
    const collectionId = episode.collection_id || episode.dramaId || drama?.collection_id || drama?.dramaId || '';
    const epNum = episode.episodeNumber || episode.episode_number || 1;
    return {
      provider: 'pinedrama',
      endpoint: `https://api.sansekai.my.id/api/pinedrama/get-episode?collection_id=${collectionId}&episodeNumber=${epNum}&lang=id`,
      hasVideoId: true,
      collectionId,
      epNum,
    };
  }
};
