import mongoose, { Schema, Document } from 'mongoose';

export interface IDrama extends Document {
  dramaId: string; // collection_id / bookId
  collection_id: string; // alias
  title: string;
  coverUrl: string;
  synopsis: string;
  categories: string[];
  totalEpisodes: number;
  syncedEpisodesCount: number;
  pendingEpisodesCount: number;
  syncStatus: 'PENDING_EPISODES' | 'PARTIAL' | 'COMPLETED' | 'FAILED';
  source?: string;
  isNewlyAdded?: boolean;
  importedAt?: Date;
  lastSyncedAt?: Date;
}

const DramaSchema = new Schema<IDrama>(
  {
    dramaId: { type: String, required: true, unique: true, index: true },
    collection_id: { type: String, index: true },
    title: { type: String, required: true, index: true },
    coverUrl: { type: String, default: '' },
    synopsis: { type: String, default: '' },
    categories: { type: [String], default: [] },
    totalEpisodes: { type: Number, default: 0 },
    syncedEpisodesCount: { type: Number, default: 0 },
    pendingEpisodesCount: { type: Number, default: 0 },
    syncStatus: {
      type: String,
      enum: ['PENDING_EPISODES', 'PARTIAL', 'COMPLETED', 'FAILED'],
      default: 'PENDING_EPISODES',
    },
    source: { type: String, default: 'PineDrama Catalog' },
    isNewlyAdded: { type: Boolean, default: true },
    importedAt: { type: Date, default: Date.now },
    lastSyncedAt: { type: Date },
  },
  {
    timestamps: true,
    collection: 'pinedrama_dramas',
  }
);

export const Drama = mongoose.models.Drama || mongoose.model<IDrama>('Drama', DramaSchema);
