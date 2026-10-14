import { connectDB } from './db.js';
import { Category } from '../models/Category.js';
import { Drama } from '../models/Drama.js';
import { Episode } from '../models/Episode.js';
import { SyncJobState, ISyncJobState } from '../models/SyncJobState.js';
import { sansekaiApi, SansekaiCollectionItem } from './sansekaiPinedramaApi.js';
import { DEFAULT_PINEDRAMA_CONFIG } from '../config/pinedramaEndpoints.js';

class SyncWorkerService {
  private isProcessing = false;
  private minuteWindowStart = Date.now();
  private requestsInWindow = 0;

  constructor() {
    //
  }

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
        logs: ['[Init] Background sync engine ready.'],
      });
    }
    return state;
  }

  async updateState(fields: Partial<ISyncJobState>) {
    await connectDB();
    await SyncJobState.findOneAndUpdate({ key: 'singleton' }, fields, { upsert: true });
  }

  private async waitForRateLimitSlot(): Promise<void> {
    const now = Date.now();
    if (now - this.minuteWindowStart >= 60000) {
      this.minuteWindowStart = now;
      this.requestsInWindow = 0;
    }

    this.requestsInWindow++;
    await this.updateState({
      requestsMadeInCurrentMinute: this.requestsInWindow,
      lastRequestTimestamp: new Date(now),
    });

    await new Promise((resolve) => setTimeout(resolve, DEFAULT_PINEDRAMA_CONFIG.rateLimitMs));
  }

  public async startWorkerLoop() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      await connectDB();
      const state = await this.getState();

      if (state.isPaused) {
        await this.addLog('Sync engine is currently paused.');
        this.isProcessing = false;
        return;
      }

      await this.updateState({ isRunning: true });
      await this.addLog('Starting/Resuming background sync loop...');

      while (this.isProcessing) {
        const currentState = await this.getState();

        if (currentState.isPaused) {
          await this.addLog('Sync engine paused by user request.');
          await this.updateState({ isRunning: false, currentTask: 'PAUSED' });
          break;
        }

        if (currentState.cooldownUntil && new Date(currentState.cooldownUntil) > new Date()) {
          const waitSecs = Math.ceil((new Date(currentState.cooldownUntil).getTime() - Date.now()) / 1000);
          await this.addLog(`In HTTP 429 cooldown period. Waiting ${waitSecs}s...`);
          await new Promise((res) => setTimeout(res, 5000));
          continue;
        }

        const stepExecuted = await this.executeNextStep();
        if (!stepExecuted) {
          await this.addLog('No pending tasks or pending episodes remaining in database. Worker resting.');
          await this.updateState({ isRunning: false, currentTask: 'IDLE' });
          break;
        }
      }
    } catch (error) {
      const formatted = sansekaiApi.formatError(error);
      await this.addLog(`Unhandled worker loop error: ${formatted.message}`);
      await this.updateState({ isRunning: false, currentTask: 'FAILED' });
    } finally {
      this.isProcessing = false;
    }
  }

  public async pause() {
    this.isProcessing = false;
    await this.updateState({ isPaused: true, isRunning: false, currentTask: 'PAUSED' });
    await this.addLog('Background worker gracefully paused.');
  }

  public async resume() {
    await this.updateState({ isPaused: false });
    await this.addLog('Resume command received.');
    this.startWorkerLoop();
  }

  public async prioritizeDrama(dramaId: string) {
    await this.updateState({ priorityDramaId: dramaId });
    await this.addLog(`Priority set to Drama ID: ${dramaId}`);
    if (!this.isProcessing) {
      this.resume();
    }
  }

  private async executeNextStep(): Promise<boolean> {
    const state = await this.getState();

    if (state.currentTask === 'FETCH_CATEGORIES') {
      await this.syncCategoriesAndTitles();
      return true;
    }

    const missingSkeletonDrama = await Drama.findOne({
      $expr: { $gt: ['$totalEpisodes', 0] },
    }).lean();

    if (missingSkeletonDrama) {
      const epCount = await Episode.countDocuments({ dramaId: missingSkeletonDrama.dramaId });
      if (epCount < missingSkeletonDrama.totalEpisodes) {
        await this.addLog(`Creating missing episode skeleton records for Drama: ${missingSkeletonDrama.title}`);
        await this.createSkeletonEpisodes(missingSkeletonDrama.dramaId, missingSkeletonDrama.totalEpisodes);
        return true;
      }
    }

    return await this.syncNextPendingEpisode();
  }

  public async triggerSyncCategoriesAndTitles() {
    await this.updateState({ currentTask: 'FETCH_CATEGORIES', isPaused: false });
    await this.addLog('Queued stage 1: Syncing Categories & Drama Titles.');
    if (!this.isProcessing) {
      this.startWorkerLoop();
    }
  }

  private async syncCategoriesAndTitles() {
    await this.addLog('=== STAGE 1: Syncing PineDrama Categories & Drama Titles ===');
    await this.updateState({ currentTask: 'FETCH_CATEGORIES' });

    const categoriesFound = new Set<string>();
    const collectionsToProcess: SansekaiCollectionItem[] = [];

    try {
      // Fetch ForYou Pages
      for (const pageCursor of ['1', '2', '3']) {
        await this.waitForRateLimitSlot();
        await this.addLog(`Fetching PineDrama ForYou page cursor: ${pageCursor}`);
        try {
          const res = await sansekaiApi.getForYou(pageCursor);
          if (res && Array.isArray(res.collections)) {
            collectionsToProcess.push(...res.collections);
          }
        } catch (e: any) {
          const errInfo = sansekaiApi.formatError(e);
          await this.addLog(`[Error fetching ForYou cursor ${pageCursor}]: ${errInfo.message}`);
          if (errInfo.status === 403) {
            await this.addLog(`[CLOUDFLARE 403 DETECTED] Backend IP blocked by Cloudflare. Please use "Browser-Assisted Fetch (Bypass 403)" mode on the UI!`);
          } else if (errInfo.status === 429) {
            await this.handle429Error();
            return;
          }
        }
      }

      // Fetch Trending Pages
      for (const pageCursor of ['1', '2']) {
        await this.waitForRateLimitSlot();
        await this.addLog(`Fetching PineDrama Trending page cursor: ${pageCursor}`);
        try {
          const res = await sansekaiApi.getTrending(pageCursor);
          if (res && Array.isArray(res.collections)) {
            collectionsToProcess.push(...res.collections);
          }
        } catch (e: any) {
          const errInfo = sansekaiApi.formatError(e);
          await this.addLog(`[Error fetching Trending cursor ${pageCursor}]: ${errInfo.message}`);
          if (errInfo.status === 403) {
            await this.addLog(`[CLOUDFLARE 403 DETECTED] Backend IP blocked by Cloudflare. Please use "Browser-Assisted Fetch (Bypass 403)" mode on the UI!`);
          } else if (errInfo.status === 429) {
            await this.handle429Error();
            return;
          }
        }
      }

      await this.addLog(`Processing ${collectionsToProcess.length} drama collection items...`);
      if (collectionsToProcess.length > 0) {
        await this.ingestCollectionsBatch(collectionsToProcess);
      } else {
        await this.addLog('No collections returned by backend API. If 403 occurred, please toggle "Browser-Assisted Fetch" mode.');
      }

      await this.updateState({ currentTask: 'FETCH_EPISODE_STREAMS' });
    } catch (err) {
      const formatted = sansekaiApi.formatError(err);
      await this.addLog(`Error in stage 1 category sync: ${formatted.message}`);
    }
  }

  /**
   * Helper to ingest collections array into Category, Drama, and Episode collections
   */
  public async ingestCollectionsBatch(collections: SansekaiCollectionItem[]) {
    const categoriesFound = new Set<string>();

    for (const item of collections) {
      if (!item.collection_id || !item.title) continue;

      let dramaCats: string[] = [];
      if (item.categories) {
        dramaCats = item.categories.split(',').map((c) => c.trim()).filter(Boolean);
      } else if (Array.isArray(item.tags)) {
        dramaCats = item.tags;
      }
      if (dramaCats.length === 0) dramaCats = ['General'];

      dramaCats.forEach((c) => categoriesFound.add(c));
      const totalEps = item.total_episodes || 30;

      const existingDrama = await Drama.findOne({ dramaId: item.collection_id });
      if (!existingDrama) {
        await Drama.create({
          dramaId: item.collection_id,
          title: item.title,
          coverUrl: item.cover || '',
          synopsis: item.description || '',
          categories: dramaCats,
          totalEpisodes: totalEps,
          syncedEpisodesCount: 0,
          pendingEpisodesCount: totalEps,
          syncStatus: 'PENDING_EPISODES',
          lastSyncedAt: new Date(),
        });
        await this.createSkeletonEpisodes(item.collection_id, totalEps);
      } else {
        existingDrama.coverUrl = item.cover || existingDrama.coverUrl;
        existingDrama.synopsis = item.description || existingDrama.synopsis;
        existingDrama.categories = Array.from(new Set([...existingDrama.categories, ...dramaCats]));
        if (item.total_episodes && item.total_episodes > existingDrama.totalEpisodes) {
          existingDrama.totalEpisodes = item.total_episodes;
          await this.createSkeletonEpisodes(item.collection_id, item.total_episodes);
        }
        await existingDrama.save();
      }
    }

    for (const catName of categoriesFound) {
      const slug = catName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const count = await Drama.countDocuments({ categories: catName });
      await Category.findOneAndUpdate(
        { categoryId: slug },
        {
          categoryId: slug,
          name: catName,
          slug,
          totalTitles: count,
          syncStatus: 'COMPLETED',
          lastSyncedAt: new Date(),
        },
        { upsert: true }
      );
    }
  }

  private async createSkeletonEpisodes(dramaId: string, totalEpisodes: number) {
    const existingEpNumbers = new Set(
      (await Episode.find({ dramaId }, { episodeNumber: 1 }).lean()).map((e) => e.episodeNumber)
    );

    const docs = [];
    for (let i = 1; i <= totalEpisodes; i++) {
      if (!existingEpNumbers.has(i)) {
        docs.push({
          dramaId,
          episodeId: `${dramaId}_ep_${i}`,
          episodeNumber: i,
          title: `Episode ${i}`,
          streamUrl: null,
          syncStatus: 'PENDING',
          errorMessage: null,
        });
      }
    }

    if (docs.length > 0) {
      await Episode.insertMany(docs, { ordered: false }).catch(() => {});
    }

    await this.recalculateDramaCounts(dramaId);
  }

  private async syncNextPendingEpisode(): Promise<boolean> {
    const state = await this.getState();
    let episodeToSync = null;

    if (state.priorityDramaId) {
      episodeToSync = await Episode.findOne({
        dramaId: state.priorityDramaId,
        syncStatus: { $in: ['PENDING', 'FAILED'] },
      }).sort({ episodeNumber: 1 });

      if (!episodeToSync) {
        await this.addLog(`Priority Drama ID ${state.priorityDramaId} has no more pending episodes.`);
        await this.updateState({ priorityDramaId: null });
      }
    }

    if (!episodeToSync) {
      episodeToSync = await Episode.findOne({
        syncStatus: { $in: ['PENDING', 'FAILED'] },
      }).sort({ dramaId: 1, episodeNumber: 1 });
    }

    if (!episodeToSync) {
      return false;
    }

    const drama = await Drama.findOne({ dramaId: episodeToSync.dramaId });
    const dramaTitle = drama ? drama.title : episodeToSync.dramaId;

    await this.updateState({
      currentTask: 'FETCH_EPISODE_STREAMS',
      currentDramaId: episodeToSync.dramaId,
      currentEpisodeNumber: episodeToSync.episodeNumber,
    });

    await this.waitForRateLimitSlot();
    await this.addLog(`Syncing "${dramaTitle}" - Episode ${episodeToSync.episodeNumber}...`);

    try {
      const result = await sansekaiApi.getEpisode(episodeToSync.dramaId, episodeToSync.episodeNumber);

      if (result && result.streamUrl) {
        episodeToSync.streamUrl = result.streamUrl;
        episodeToSync.syncStatus = 'SYNCED';
        episodeToSync.errorMessage = null;
        if (result.title) episodeToSync.title = result.title;
        await episodeToSync.save();

        await this.addLog(`✔ SYNCED: "${dramaTitle}" Ep ${episodeToSync.episodeNumber} -> ${result.streamUrl.slice(0, 45)}...`);
      } else {
        const errorMsg = result?.error || 'Stream URL not returned by Sansekai API';
        episodeToSync.syncStatus = 'FAILED';
        episodeToSync.errorMessage = errorMsg;
        await episodeToSync.save();

        await this.addLog(`✖ FAILED: "${dramaTitle}" Ep ${episodeToSync.episodeNumber}: ${errorMsg}`);
      }

      await this.recalculateDramaCounts(episodeToSync.dramaId);
      return true;
    } catch (err: any) {
      const formatted = sansekaiApi.formatError(err);
      if (formatted.status === 429) {
        await this.handle429Error();
        return true;
      }
      if (formatted.status === 403) {
        await this.addLog(`[CLOUDFLARE 403 DETECTED] Ep ${episodeToSync.episodeNumber} fetch blocked on backend IP. Use "Browser-Assisted Fetch" mode!`);
      }
      episodeToSync.syncStatus = 'FAILED';
      episodeToSync.errorMessage = formatted.message;
      await episodeToSync.save();
      await this.recalculateDramaCounts(episodeToSync.dramaId);
      await this.addLog(`Error syncing Ep ${episodeToSync.episodeNumber} for ${dramaTitle}: ${formatted.message}`);
      return true;
    }
  }

  public async fetchSingleEpisodeOnDemand(dramaId: string, episodeNumber: number) {
    await connectDB();
    const episode = await Episode.findOne({ dramaId, episodeNumber });

    if (episode && episode.syncStatus === 'SYNCED' && episode.streamUrl) {
      return episode.streamUrl;
    }

    const drama = await Drama.findOne({ dramaId });
    const dramaTitle = drama ? drama.title : dramaId;

    await this.addLog(`[ON-DEMAND] Fetching priority stream for "${dramaTitle}" Ep ${episodeNumber}...`);
    await this.waitForRateLimitSlot();

    try {
      const result = await sansekaiApi.getEpisode(dramaId, episodeNumber);
      if (result && result.streamUrl) {
        await Episode.findOneAndUpdate(
          { dramaId, episodeNumber },
          {
            streamUrl: result.streamUrl,
            syncStatus: 'SYNCED',
            errorMessage: null,
            title: result.title || `Episode ${episodeNumber}`,
          },
          { upsert: true }
        );
        await this.recalculateDramaCounts(dramaId);
        await this.addLog(`[ON-DEMAND SUCCESS] "${dramaTitle}" Ep ${episodeNumber} is ready to stream.`);
        return result.streamUrl;
      } else {
        const errorMsg = result?.error || 'Episode stream not found';
        await Episode.findOneAndUpdate(
          { dramaId, episodeNumber },
          { syncStatus: 'FAILED', errorMessage: errorMsg },
          { upsert: true }
        );
        throw new Error(errorMsg);
      }
    } catch (err: any) {
      const formatted = sansekaiApi.formatError(err);
      if (formatted.status === 429) {
        await this.handle429Error();
      }
      throw new Error(`Failed to fetch stream: ${formatted.message}`);
    }
  }

  public async recalculateDramaCounts(dramaId: string) {
    const totalInDb = await Episode.countDocuments({ dramaId });
    const syncedCount = await Episode.countDocuments({ dramaId, syncStatus: 'SYNCED' });
    const pendingCount = await Episode.countDocuments({ dramaId, syncStatus: { $ne: 'SYNCED' } });

    let dramaStatus: 'PENDING_EPISODES' | 'PARTIAL' | 'COMPLETED' | 'FAILED' = 'PENDING_EPISODES';
    if (syncedCount === totalInDb && totalInDb > 0) {
      dramaStatus = 'COMPLETED';
    } else if (syncedCount > 0) {
      dramaStatus = 'PARTIAL';
    }

    await Drama.findOneAndUpdate(
      { dramaId },
      {
        totalEpisodes: Math.max(totalInDb, 1),
        syncedEpisodesCount: syncedCount,
        pendingEpisodesCount: pendingCount,
        syncStatus: dramaStatus,
        lastSyncedAt: new Date(),
      }
    );
  }

  private async handle429Error() {
    const cooldownMs = DEFAULT_PINEDRAMA_CONFIG.cooldownOn429Ms;
    const cooldownUntil = new Date(Date.now() + cooldownMs);
    await this.addLog(`[RATE LIMIT EXCEEDED 429] Entering 65-second cooldown period until ${cooldownUntil.toISOString().slice(11, 19)}...`);
    await this.updateState({ cooldownUntil });
  }
}

export const syncWorker = new SyncWorkerService();
