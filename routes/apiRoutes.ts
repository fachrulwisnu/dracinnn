import { Router, Request, Response } from 'express';
import { connectDB } from '../services/db.js';
import { Category } from '../models/Category.js';
import { Drama } from '../models/Drama.js';
import { Episode } from '../models/Episode.js';
import { SyncJobState } from '../models/SyncJobState.js';
import { NewlyAddedLog } from '../models/NewlyAddedLog.js';
import { syncWorker } from '../services/rateLimitedSyncWorker.js';
import { sansekaiApi, parseEpisodeResponse } from '../services/sansekaiPinedramaApi.js';

const router = Router();

router.use(async (_req, _res, next) => {
  try {
    await connectDB();
    next();
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/categories
 */
router.get('/categories', async (_req: Request, res: Response) => {
  try {
    const categories = await Category.find().sort({ totalTitles: -1, name: 1 });
    res.json({ success: true, count: categories.length, categories });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/dramas
 * Supports categoryId, syncStatus, q search, and sort (importedAt_desc, eps_desc, eps_asc, progress_desc)
 */
router.get('/dramas', async (req: Request, res: Response) => {
  try {
    const { categoryId, syncStatus, q, sort } = req.query;
    const filter: any = {};

    if (categoryId && categoryId !== 'all') {
      const categoryDoc = await Category.findOne({ categoryId: categoryId as string });
      if (categoryDoc) {
        filter.categories = categoryDoc.name;
      } else {
        filter.categories = categoryId as string;
      }
    }

    if (syncStatus && syncStatus !== 'all') {
      filter.syncStatus = syncStatus as string;
    }

    if (q && typeof q === 'string' && q.trim()) {
      filter.title = { $regex: q.trim(), $options: 'i' };
    }

    let sortObj: any = { importedAt: -1, updatedAt: -1 };
    if (sort === 'eps_desc') {
      sortObj = { totalEpisodes: -1 };
    } else if (sort === 'eps_asc') {
      sortObj = { totalEpisodes: 1 };
    } else if (sort === 'progress_desc') {
      sortObj = { syncedEpisodesCount: -1 };
    } else if (sort === 'importedAt_desc') {
      sortObj = { importedAt: -1, createdAt: -1 };
    }

    const dramas = await Drama.find(filter).sort(sortObj);

    res.json({
      success: true,
      count: dramas.length,
      dramas,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/dramas/check-existing
 * Compares incoming collection_ids against MongoDB Atlas
 */
router.post('/dramas/check-existing', async (req: Request, res: Response) => {
  try {
    const { collectionIds } = req.body;
    if (!Array.isArray(collectionIds) || collectionIds.length === 0) {
      return res.json({ success: true, existingMap: {} });
    }

    const existingDocs = await Drama.find({
      $or: [{ dramaId: { $in: collectionIds } }, { collection_id: { $in: collectionIds } }],
    }).lean();

    const existingMap: Record<string, any> = {};
    for (const doc of existingDocs) {
      const id = doc.collection_id || doc.dramaId;
      existingMap[id] = {
        inDb: true,
        dbTotalEpisodes: doc.totalEpisodes || 0,
        dbSyncedEpisodes: doc.syncedEpisodesCount || 0,
        dbPendingEpisodes: doc.pendingEpisodesCount || 0,
        syncStatus: doc.syncStatus,
        importedAt: doc.importedAt,
      };
    }

    res.json({ success: true, existingMap });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/sync/import-dramas
 * Selective & Batch insert into MongoDB Atlas (Drama + Episode Skeletons + Category Sync + Newly Added Log)
 */
router.post('/sync/import-dramas', async (req: Request, res: Response) => {
  try {
    const { dramas, source } = req.body;
    if (!Array.isArray(dramas) || dramas.length === 0) {
      return res.status(400).json({ success: false, error: 'No dramas provided to import.' });
    }

    const importSource = source || 'PineDrama Explorer';
    const newlyAddedList: any[] = [];
    let totalNewEpisodesAdded = 0;
    const categoriesFound = new Set<string>();

    for (const item of dramas) {
      const collectionId = item.collection_id || item.dramaId;
      if (!collectionId || !item.title) continue;

      let dramaCats: string[] = item.categories || [];
      if (typeof dramaCats === 'string') {
        dramaCats = (dramaCats as string).split(',').map((c) => c.trim()).filter(Boolean);
      }
      if (dramaCats.length === 0) dramaCats = ['General'];
      dramaCats.forEach((c) => categoriesFound.add(c));

      const totalEps = item.totalEpisodes || item.total_episodes || 30;

      const existingDrama = await Drama.findOne({
        $or: [{ dramaId: collectionId }, { collection_id: collectionId }],
      });

      if (!existingDrama) {
        await Drama.create({
          dramaId: collectionId,
          collection_id: collectionId,
          title: item.title,
          coverUrl: item.coverUrl || item.cover || '',
          synopsis: item.synopsis || item.description || '',
          categories: dramaCats,
          totalEpisodes: totalEps,
          syncedEpisodesCount: 0,
          pendingEpisodesCount: totalEps,
          syncStatus: 'PENDING_EPISODES',
          source: importSource,
          isNewlyAdded: true,
          importedAt: new Date(),
          lastSyncedAt: new Date(),
        });

        // Create skeleton episode documents (1..totalEps)
        const epDocs = [];
        for (let i = 1; i <= totalEps; i++) {
          epDocs.push({
            dramaId: collectionId,
            collection_id: collectionId,
            episodeId: `${collectionId}_ep_${i}`,
            episodeNumber: i,
            title: `Episode ${i}`,
            streamUrl: null,
            syncStatus: 'PENDING',
            errorMessage: null,
          });
        }
        if (epDocs.length > 0) {
          await Episode.insertMany(epDocs, { ordered: false }).catch(() => {});
        }

        newlyAddedList.push({
          dramaId: collectionId,
          title: item.title,
          coverUrl: item.coverUrl || item.cover || '',
          totalEpisodes: totalEps,
          categories: dramaCats,
        });
        totalNewEpisodesAdded += totalEps;
      } else {
        // Update existing
        existingDrama.coverUrl = item.coverUrl || item.cover || existingDrama.coverUrl;
        existingDrama.synopsis = item.synopsis || item.description || existingDrama.synopsis;
        existingDrama.categories = Array.from(new Set([...existingDrama.categories, ...dramaCats]));
        if (totalEps > existingDrama.totalEpisodes) {
          const diff = totalEps - existingDrama.totalEpisodes;
          existingDrama.totalEpisodes = totalEps;

          const epDocs = [];
          for (let i = existingDrama.totalEpisodes + 1; i <= totalEps; i++) {
            epDocs.push({
              dramaId: collectionId,
              collection_id: collectionId,
              episodeId: `${collectionId}_ep_${i}`,
              episodeNumber: i,
              title: `Episode ${i}`,
              streamUrl: null,
              syncStatus: 'PENDING',
              errorMessage: null,
            });
          }
          if (epDocs.length > 0) {
            await Episode.insertMany(epDocs, { ordered: false }).catch(() => {});
          }
          totalNewEpisodesAdded += diff;
        }
        await existingDrama.save();
      }
    }

    // Upsert Category Documents
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

    // Log newly added summary
    if (newlyAddedList.length > 0) {
      await NewlyAddedLog.create({
        source: importSource,
        totalImported: newlyAddedList.length,
        totalNewEpisodes: totalNewEpisodesAdded,
        dramas: newlyAddedList,
        importedAt: new Date(),
      });

      await syncWorker.addLog(
        `✅ [NEWLY IMPORTED] ${newlyAddedList.length} new titles (+${totalNewEpisodesAdded} pending episodes) added to MongoDB Atlas from "${importSource}".`
      );
    }

    res.json({
      success: true,
      message: `Imported ${newlyAddedList.length} new dramas (+${totalNewEpisodesAdded} episodes).`,
      importedCount: newlyAddedList.length,
      totalNewEpisodes: totalNewEpisodesAdded,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/sync/newly-added
 * Returns history of newly imported dramas
 */
router.get('/sync/newly-added', async (_req: Request, res: Response) => {
  try {
    const logs = await NewlyAddedLog.find().sort({ importedAt: -1 }).limit(30);
    res.json({ success: true, count: logs.length, logs });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/dramas/:dramaId
 */
router.get('/dramas/:dramaId', async (req: Request, res: Response) => {
  try {
    const { dramaId } = req.params;
    const drama = await Drama.findOne({ $or: [{ dramaId }, { collection_id: dramaId }] });

    if (!drama) {
      return res.status(404).json({ success: false, error: 'Drama not found' });
    }

    const episodes = await Episode.find({
      $or: [{ dramaId: drama.dramaId }, { collection_id: drama.dramaId }],
    }).sort({ episodeNumber: 1 });

    res.json({
      success: true,
      drama,
      episodes,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/episodes/:dramaId/:episodeNumber/stream
 */
router.get('/episodes/:dramaId/:episodeNumber/stream', async (req: Request, res: Response) => {
  try {
    const { dramaId, episodeNumber } = req.params;
    const epNum = parseInt(episodeNumber, 10);

    const episode = await Episode.findOne({
      $or: [{ dramaId }, { collection_id: dramaId }],
      episodeNumber: epNum,
    });

    if (episode && episode.syncStatus === 'SYNCED' && (episode.bestUrl || episode.streamUrl)) {
      return res.json({
        success: true,
        streamUrl: episode.bestUrl || episode.streamUrl,
        bestUrl: episode.bestUrl || episode.streamUrl,
        videoId: episode.video_id,
        quality: episode.quality,
        backupUrls: episode.backupUrls || [],
        syncStatus: 'SYNCED',
        isOnDemand: false,
        title: episode.title,
      });
    }

    const streamUrl = await syncWorker.fetchSingleEpisodeOnDemand(dramaId, epNum);

    const updatedEp = await Episode.findOne({
      $or: [{ dramaId }, { collection_id: dramaId }],
      episodeNumber: epNum,
    });

    res.json({
      success: true,
      streamUrl,
      bestUrl: updatedEp?.bestUrl || streamUrl,
      videoId: updatedEp?.video_id || null,
      quality: updatedEp?.quality || 'HD_INDO',
      backupUrls: updatedEp?.backupUrls || [streamUrl],
      syncStatus: 'SYNCED',
      isOnDemand: true,
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: err.message || 'Failed to retrieve episode stream URL',
    });
  }
});

/**
 * GET /api/sync/next-pending-episodes
 */
router.get('/sync/next-pending-episodes', async (req: Request, res: Response) => {
  try {
    const limit = parseInt((req.query.limit as string) || '10', 10);
    const collectionId = req.query.collection_id as string;

    const filter: any = { syncStatus: { $in: ['PENDING', 'FAILED'] } };
    if (collectionId) {
      filter.$or = [{ dramaId: collectionId }, { collection_id: collectionId }];
    }

    const pendingList = await Episode.find(filter)
      .sort({ dramaId: 1, episodeNumber: 1 })
      .limit(limit)
      .lean();

    const formatted = pendingList.map((ep) => ({
      dramaId: ep.dramaId,
      collection_id: ep.collection_id || ep.dramaId,
      episodeNumber: ep.episodeNumber,
      title: ep.title,
    }));

    res.json({ success: true, count: formatted.length, pendingEpisodes: formatted });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/sync/save-episode
 */
router.post('/sync/save-episode', async (req: Request, res: Response) => {
  try {
    const { collection_id, dramaId, episodeNumber, rawResponse, syncStatus, errorMessage } = req.body;
    const targetDramaId = collection_id || dramaId;
    const epNum = parseInt(episodeNumber, 10);

    if (!targetDramaId || isNaN(epNum)) {
      return res.status(400).json({ success: false, error: 'collection_id and episodeNumber required' });
    }

    if (rawResponse) {
      const parsed = parseEpisodeResponse(rawResponse, epNum);

      const status = parsed.best_url ? 'SYNCED' : 'FAILED';
      const err = parsed.error || errorMessage || null;

      await Episode.findOneAndUpdate(
        { $or: [{ dramaId: targetDramaId }, { collection_id: targetDramaId }], episodeNumber: epNum },
        {
          dramaId: targetDramaId,
          collection_id: targetDramaId,
          episodeNumber: epNum,
          video_id: parsed.video_id,
          title: parsed.title,
          bestUrl: parsed.best_url,
          streamUrl: parsed.best_url,
          quality: parsed.quality || 'HD_INDO',
          backupUrls: parsed.backup_urls,
          syncStatus: status,
          errorMessage: err,
          lastSyncedAt: new Date(),
        },
        { upsert: true }
      );

      await syncWorker.recalculateDramaCounts(targetDramaId);

      const dramaDoc = await Drama.findOne({ dramaId: targetDramaId });
      const dramaTitle = dramaDoc ? dramaDoc.title : targetDramaId;

      if (parsed.best_url) {
        await syncWorker.addLog(`✔ [BROWSER SYNCED] "${dramaTitle}" Ep ${epNum} -> ${parsed.best_url.slice(0, 45)}...`);
      } else {
        await syncWorker.addLog(`✖ [BROWSER SYNC FAILED] "${dramaTitle}" Ep ${epNum}: ${err || 'No stream URL'}`);
      }

      return res.json({ success: true, message: `Episode ${epNum} saved successfully.` });
    } else {
      const { bestUrl, streamUrl, video_id, quality, backupUrls, title } = req.body;
      const finalUrl = bestUrl || streamUrl || null;
      const status = syncStatus || (finalUrl ? 'SYNCED' : 'FAILED');

      await Episode.findOneAndUpdate(
        { $or: [{ dramaId: targetDramaId }, { collection_id: targetDramaId }], episodeNumber: epNum },
        {
          dramaId: targetDramaId,
          collection_id: targetDramaId,
          episodeNumber: epNum,
          video_id: video_id || null,
          title: title || `Episode ${epNum}`,
          bestUrl: finalUrl,
          streamUrl: finalUrl,
          quality: quality || 'HD_INDO',
          backupUrls: backupUrls || (finalUrl ? [finalUrl] : []),
          syncStatus: status,
          errorMessage: errorMessage || null,
          lastSyncedAt: new Date(),
        },
        { upsert: true }
      );

      await syncWorker.recalculateDramaCounts(targetDramaId);
      return res.json({ success: true, message: `Episode ${epNum} updated.` });
    }
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/sync/status
 */
router.get('/sync/status', async (_req: Request, res: Response) => {
  try {
    const state = await syncWorker.getState();

    const totalCategories = await Category.countDocuments();
    const totalDramas = await Drama.countDocuments();
    const syncedEpisodes = await Episode.countDocuments({ syncStatus: 'SYNCED' });
    const pendingEpisodes = await Episode.countDocuments({ syncStatus: { $ne: 'SYNCED' } });

    res.json({
      success: true,
      workerState: state,
      counters: {
        totalCategories,
        totalDramas,
        syncedEpisodes,
        pendingEpisodes,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/sync/categories
 */
router.post('/sync/categories', async (_req: Request, res: Response) => {
  try {
    await syncWorker.triggerSyncCategoriesAndTitles();
    res.json({ success: true, message: 'Stage 1 Category & Drama Sync triggered.' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/sync/drama/:dramaId
 */
router.post('/sync/drama/:dramaId', async (req: Request, res: Response) => {
  try {
    const { dramaId } = req.params;
    await syncWorker.prioritizeDrama(dramaId);
    res.json({ success: true, message: `Drama ${dramaId} set as sync priority.` });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/sync/episodes/resume
 */
router.post('/sync/episodes/resume', async (_req: Request, res: Response) => {
  try {
    await syncWorker.resume();
    res.json({ success: true, message: 'Background episode sync worker resumed.' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/sync/pause
 */
router.post('/sync/pause', async (_req: Request, res: Response) => {
  try {
    await syncWorker.pause();
    res.json({ success: true, message: 'Background worker paused.' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * DELETE /api/sync/logs
 */
router.delete('/sync/logs', async (_req: Request, res: Response) => {
  try {
    await SyncJobState.findOneAndUpdate({ key: 'singleton' }, { logs: [] });
    res.json({ success: true, message: 'Logs cleared.' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
