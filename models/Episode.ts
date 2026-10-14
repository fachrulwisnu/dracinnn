import mongoose, { Schema, Document } from 'mongoose';

export interface IEpisode extends Document {
  provider: 'pinedrama';
  dramaId: string; // collection_id
  collection_id: string;
  book_id?: string;
  episodeNumber: number;
  video_id?: string | null;
  title: string;
  bestUrl: string | null;
  streamUrl: string | null;
  quality?: string | null;
  backupUrls: string[];
  syncStatus: 'PENDING' | 'SYNCED' | 'FAILED';
  errorMessage: string | null;
  lastSyncedAt?: Date;
  updatedAt: Date;
}

const EpisodeSchema = new Schema<IEpisode>(
  {
    provider: { type: String, default: 'pinedrama', index: true },
    dramaId: { type: String, required: true, index: true },
    collection_id: { type: String, index: true },
    book_id: { type: String },
    episodeNumber: { type: Number, required: true, index: true },
    video_id: { type: String, default: null },
    title: { type: String, default: '' },
    bestUrl: { type: String, default: null },
    streamUrl: { type: String, default: null },
    quality: { type: String, default: null },
    backupUrls: { type: [String], default: [] },
    syncStatus: {
      type: String,
      enum: ['PENDING', 'SYNCED', 'FAILED'],
      default: 'PENDING',
      index: true,
    },
    errorMessage: { type: String, default: null },
    lastSyncedAt: { type: Date },
  },
  {
    timestamps: true,
    collection: 'pinedrama_episodes',
    strict: false,
  }
);

// Compound index for collection_id + episodeNumber
EpisodeSchema.index({ dramaId: 1, episodeNumber: 1 }, { unique: true });

export const Episode = mongoose.models.Episode || mongoose.model<IEpisode>('Episode', EpisodeSchema);
export const PineDramaEpisode = Episode;
