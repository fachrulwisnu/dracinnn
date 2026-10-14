import mongoose, { Schema, Document } from 'mongoose';

export interface IMeloloDrama extends Document {
  book_id: string; // alias collection_id / dramaId
  collection_id: string;
  dramaId: string;
  title: string;
  synopsis: string;
  hasSynopsis: boolean;
  coverUrl: string;
  categories: string[];
  totalEpisodes: number;
  syncedEpisodesCount: number;
  pendingEpisodesCount: number;
  views: number;
  syncStatus: 'PENDING_EPISODES' | 'PARTIAL' | 'COMPLETED' | 'FAILED';
  source?: string;
  isNewlyAdded?: boolean;
  importedAt?: Date;
  lastSyncedAt?: Date;
}

const MeloloDramaSchema = new Schema<IMeloloDrama>(
  {
    book_id: { type: String, required: true, unique: true, index: true },
    collection_id: { type: String, required: true, index: true },
    dramaId: { type: String, required: true, index: true },
    title: { type: String, required: true, index: true },
    synopsis: { type: String, default: '' },
    hasSynopsis: { type: Boolean, default: false },
    coverUrl: { type: String, default: '' },
    categories: { type: [String], default: [] },
    totalEpisodes: { type: Number, default: 0 },
    syncedEpisodesCount: { type: Number, default: 0 },
    pendingEpisodesCount: { type: Number, default: 0 },
    views: { type: Number, default: 0 },
    syncStatus: {
      type: String,
      enum: ['PENDING_EPISODES', 'PARTIAL', 'COMPLETED', 'FAILED'],
      default: 'PENDING_EPISODES',
      index: true,
    },
    source: { type: String, default: 'Melolo Explorer' },
    isNewlyAdded: { type: Boolean, default: true },
    importedAt: { type: Date, default: Date.now },
    lastSyncedAt: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
    collection: 'melolo_dramas',
  }
);

export const MeloloDrama =
  mongoose.models.MeloloDrama ||
  mongoose.model<IMeloloDrama>('MeloloDrama', MeloloDramaSchema);
