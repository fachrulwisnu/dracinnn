import { connectDB } from './db.js';
import { SyncJobState, ISyncJobState } from '../models/SyncJobState.js';
import { getDramaModel, getEpisodeModel } from './modelResolver.js';

class SyncWorkerService {
  async addLog(message: string) {
    const timestamp = new Date().toISOString().split('T')[1].slice(0, 8);
    const formattedLog = `[${timestamp}] ${message}`;
    console.log(formattedLog);

    try {
      await connectDB();
      await SyncJobState.findOneAndUpdate(
        { key: 'singleton' },
        {
          $push: {
            logs: {
              $each: [formattedLog],
              $slice: -100,
            },
          },
        },
        { upsert: true }
      );
    } catch (err) {
      console.error('[SyncWorker] Error logging to DB:', err);
    }
  }

  async getState(): Promise<ISyncJobState> {
    await connectDB();
    let state = await SyncJobState.findOne({ key: 'singleton' });
    if (!state) {
      state = await SyncJobState.create({
        key: 'singleton',
        isRunning: false,
        isPaused: false,
        currentTask: 'IDLE',
        requestsMadeInCurrentMinute: 0,
        lastRequestTimestamp: new Date(),
        logs: ['[Init] Browser-Assisted Sync Worker Engine Ready.'],
      });
    }
    return state;
  }

  async updateState(fields: Partial<ISyncJobState>) {
    await connectDB();
    await SyncJobState.findOneAndUpdate({ key: 'singleton' }, fields, { upsert: true });
  }

  /**
   * Recalculate synced vs pending episode counts for a drama in its respective collection
   */
  public async recalculateDramaCounts(dramaId: string, provider: string = 'pinedrama') {
    try {
      await connectDB();
      const DramaModel = getDramaModel(provider);
      const EpisodeModel = getEpisodeModel(provider);

      const totalInDb = await EpisodeModel.countDocuments({
        $or: [{ dramaId }, { collection_id: dramaId }, { book_id: dramaId }],
      });
      const syncedCount = await EpisodeModel.countDocuments({
        $or: [{ dramaId }, { collection_id: dramaId }, { book_id: dramaId }],
        syncStatus: 'SYNCED',
      });
      const pendingCount = await EpisodeModel.countDocuments({
        $or: [{ dramaId }, { collection_id: dramaId }, { book_id: dramaId }],
        syncStatus: { $ne: 'SYNCED' },
      });

      const dramaDoc = await DramaModel.findOne({
        $or: [{ dramaId }, { collection_id: dramaId }, { book_id: dramaId }],
      });

      const totalEpTarget = Math.max(dramaDoc?.totalEpisodes || 0, totalInDb, 1);

      let dramaStatus: 'PENDING_EPISODES' | 'PARTIAL' | 'COMPLETED' | 'FAILED' = 'PENDING_EPISODES';
      if (syncedCount >= totalEpTarget && totalEpTarget > 0) {
        dramaStatus = 'COMPLETED';
      } else if (syncedCount > 0) {
        dramaStatus = 'PARTIAL';
      }

      await DramaModel.findOneAndUpdate(
        { $or: [{ dramaId }, { collection_id: dramaId }, { book_id: dramaId }] },
        {
          totalEpisodes: totalEpTarget,
          syncedEpisodesCount: syncedCount,
          pendingEpisodesCount: Math.max(0, totalEpTarget - syncedCount),
          syncStatus: dramaStatus,
          lastSyncedAt: new Date(),
        }
      );
    } catch (err) {
      console.error(`[SyncWorker] Error recalculating drama counts for ${dramaId} (${provider}):`, err);
    }
  }
}

export const syncWorker = new SyncWorkerService();
