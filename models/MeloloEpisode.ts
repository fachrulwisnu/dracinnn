import mongoose, { Schema, Document } from 'mongoose';

export interface IMeloloQuality {
  definition?: string;
  resolution?: string;
  codec?: string;
  streamUrl?: string;
}

export interface IMeloloEpisode extends Document {
  book_id: string; // alias collection_id / dramaId
  collection_id: string;
  dramaId: string;
  episodeNumber: number; // vid_index
  video_id: string | null; // vid
  title: string;
  episodeCover?: string;
  duration?: number;
  streamUrl: string | null; // highest quality 720p streamUrl
  qualities: IMeloloQuality[];
  backupUrls: string[];
  syncStatus: 'PENDING' | 'SYNCED' | 'FAILED' | 'BACKED_UP_GDRIVE';
  gdriveFileId?: string | null;
  gdriveViewLink?: string | null;
  gdriveDirectLink?: string | null;
  errorMessage?: string | null;
  lastSyncedAt?: Date;
}

const MeloloEpisodeSchema = new Schema<IMeloloEpisode>(
  {
    book_id: { type: String, required: true, index: true },
    collection_id: { type: String, required: true, index: true },
    dramaId: { type: String, required: true, index: true },
    episodeNumber: { type: Number, required: true, index: true },
    video_id: { type: String, default: null, index: true },
    title: { type: String, default: '' },
    episodeCover: { type: String, default: '' },
    duration: { type: Number, default: 0 },
    streamUrl: { type: String, default: null },
    qualities: [
      {
        definition: { type: String },
        resolution: { type: String },
        codec: { type: String },
        streamUrl: { type: String },
      },
    ],
    backupUrls: { type: [String], default: [] },
    syncStatus: {
      type: String,
      default: 'PENDING',
      index: true,
    },
    gdriveFileId: { type: String, default: null },
    gdriveViewLink: { type: String, default: null },
    gdriveDirectLink: { type: String, default: null },
    errorMessage: { type: String, default: null },
    lastSyncedAt: { type: Date },
  },
  {
    timestamps: true,
    collection: 'melolo_episodes',
    strict: false,
  }
);

// Compound index for book_id + episodeNumber
MeloloEpisodeSchema.index({ book_id: 1, episodeNumber: 1 }, { unique: true });

export const MeloloEpisode =
  mongoose.models.MeloloEpisode ||
  mongoose.model<IMeloloEpisode>('MeloloEpisode', MeloloEpisodeSchema);
