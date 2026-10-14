import mongoose, { Schema, Document } from 'mongoose';

export interface ISyncJobState extends Document {
  key: string;
  isRunning: boolean;
  isPaused: boolean;
  currentTask: string;
  requestsMadeInCurrentMinute: number;
  lastRequestTimestamp: Date;
  currentDramaId?: string | null;
  currentEpisodeNumber?: number | null;
  priorityDramaId?: string | null;
  logs: string[];
  cooldownUntil?: Date | null;
}

const SyncJobStateSchema = new Schema<ISyncJobState>(
  {
    key: { type: String, default: 'singleton', unique: true },
    isRunning: { type: Boolean, default: false },
    isPaused: { type: Boolean, default: false },
    currentTask: { type: String, default: 'IDLE' },
    requestsMadeInCurrentMinute: { type: Number, default: 0 },
    lastRequestTimestamp: { type: Date, default: Date.now },
    currentDramaId: { type: String, default: null },
    currentEpisodeNumber: { type: Number, default: null },
    priorityDramaId: { type: String, default: null },
    logs: { type: [String], default: [] },
    cooldownUntil: { type: Date, default: null },
  },
  {
    timestamps: true,
    collection: 'pinedrama_sync_state',
  }
);

export const SyncJobState =
  mongoose.models.SyncJobState || mongoose.model<ISyncJobState>('SyncJobState', SyncJobStateSchema);
