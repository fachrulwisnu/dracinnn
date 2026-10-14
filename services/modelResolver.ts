import { PineDramaCategory } from '../models/Category.js';
import { PineDramaDrama } from '../models/Drama.js';
import { PineDramaEpisode } from '../models/Episode.js';
import { MeloloCategory } from '../models/MeloloCategory.js';
import { MeloloDrama } from '../models/MeloloDrama.js';
import { MeloloEpisode } from '../models/MeloloEpisode.js';

export function getCategoryModel(provider: string = 'pinedrama') {
  if (provider === 'melolo') {
    return MeloloCategory;
  }
  return PineDramaCategory;
}

export function getDramaModel(provider: string = 'pinedrama') {
  if (provider === 'melolo') {
    return MeloloDrama;
  }
  return PineDramaDrama;
}

export function getEpisodeModel(provider: string = 'pinedrama') {
  if (provider === 'melolo') {
    return MeloloEpisode;
  }
  return PineDramaEpisode;
}
