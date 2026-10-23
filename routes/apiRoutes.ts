import axios from 'axios';
import { Router, Request, Response } from 'express';
import { connectDB, runMigrationAndCleanup } from '../services/db.js';
import { PineDramaCategory } from '../models/Category.js';
import { PineDramaDrama } from '../models/Drama.js';
import { PineDramaEpisode } from '../models/Episode.js';
import { MeloloCategory } from '../models/MeloloCategory.js';
import { MeloloDrama } from '../models/MeloloDrama.js';
import { MeloloEpisode } from '../models/MeloloEpisode.js';
import { SyncJobState } from '../models/SyncJobState.js';
import { NewlyAddedLog } from '../models/NewlyAddedLog.js';
import { syncWorker } from '../services/rateLimitedSyncWorker.js';
import { sansekaiApi } from '../services/sansekaiPinedramaApi.js';
import { getCategoryModel, getDramaModel, getEpisodeModel } from '../services/modelResolver.js';
import { normalizeDramaItem, normalizeMeloloDetail, normalizeEpisodeResponse } from '../services/providerAdapter.js';
import { getDramaFolder, uploadVideoFromUrl } from '../services/gdriveService.js';

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
 * Supports provider filter ('all' | 'pinedrama' | 'melolo')
 */
router.get('/categories', async (req: Request, res: Response) => {
  try {
    const { provider } = req.query;
    let categories: any[] = [];

    if (!provider || provider === 'all') {
      const pineCats = await PineDramaCategory.find().sort({ totalTitles: -1, name: 1 }).lean();
      const meloloCats = await MeloloCategory.find().sort({ totalTitles: -1, name: 1 }).lean();

      categories = [
        ...pineCats.map((c) => ({ ...c, provider: 'pinedrama' })),
        ...meloloCats.map((c) => ({ ...c, provider: 'melolo' })),
      ];
    } else if (provider === 'melolo') {
      const meloloCats = await MeloloCategory.find().sort({ totalTitles: -1, name: 1 }).lean();
      categories = meloloCats.map((c) => ({ ...c, provider: 'melolo' }));
    } else {
      const pineCats = await PineDramaCategory.find().sort({ totalTitles: -1, name: 1 }).lean();
      categories = pineCats.map((c) => ({ ...c, provider: 'pinedrama' }));
    }

    res.json({ success: true, count: categories.length, categories });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/dramas
 * Supports provider ('all' | 'pinedrama' | 'melolo'), categoryId, syncStatus, q, sort
 */
router.get('/dramas', async (req: Request, res: Response) => {
  try {
    const { provider, categoryId, syncStatus, q, sort } = req.query;
    const targetProvider = (provider as string) || 'all';

    const buildFilter = (catName?: string) => {
      const filter: any = {};
      if (catName && catName !== 'all') {
        filter.categories = catName;
      }
      if (syncStatus && syncStatus !== 'all') {
        filter.syncStatus = syncStatus as string;
      }
      if (q && typeof q === 'string' && q.trim()) {
        filter.title = { $regex: q.trim(), $options: 'i' };
      }
      return filter;
    };

    let categoryName = 'all';
    if (categoryId && categoryId !== 'all') {
      const pineCat = await PineDramaCategory.findOne({ categoryId: categoryId as string });
      const meloloCat = await MeloloCategory.findOne({ categoryId: categoryId as string });
      categoryName = pineCat?.name || meloloCat?.name || (categoryId as string);
    }

    let dramas: any[] = [];

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

    const filter = buildFilter(categoryName);

    if (targetProvider === 'all' || targetProvider === 'pinedrama') {
      const pineDramas = await PineDramaDrama.find(filter).sort(sortObj).lean();
      dramas.push(...pineDramas.map((d) => ({ ...d, provider: 'pinedrama' })));
    }

    if (targetProvider === 'all' || targetProvider === 'melolo') {
      const meloloDramas = await MeloloDrama.find(filter).sort(sortObj).lean();
      dramas.push(...meloloDramas.map((d) => ({ ...d, provider: 'melolo' })));
    }

    // Sort combined list if 'all'
    if (targetProvider === 'all') {
      dramas.sort((a, b) => {
        if (sort === 'eps_desc') return (b.totalEpisodes || 0) - (a.totalEpisodes || 0);
        if (sort === 'eps_asc') return (a.totalEpisodes || 0) - (b.totalEpisodes || 0);
        if (sort === 'progress_desc') return (b.syncedEpisodesCount || 0) - (a.syncedEpisodesCount || 0);
        const timeA = new Date(a.importedAt || a.createdAt || 0).getTime();
        const timeB = new Date(b.importedAt || b.createdAt || 0).getTime();
        return timeB - timeA;
      });
    }

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
 * GET /api/dramas/audit-synopsis
 * Returns stats on dramas lacking synopsis across collections
 */
router.get('/dramas/audit-synopsis', async (_req: Request, res: Response) => {
  try {
    const pineNeedy = await PineDramaDrama.find({
      $or: [{ synopsis: '' }, { synopsis: null }, { synopsis: { $exists: false } }],
    }).lean();

    const meloloNeedy = await MeloloDrama.find({
      $or: [{ synopsis: '' }, { synopsis: null }, { hasSynopsis: false }],
    }).lean();

    res.json({
      success: true,
      pineNeedyCount: pineNeedy.length,
      meloloNeedyCount: meloloNeedy.length,
      totalNeedyCount: pineNeedy.length + meloloNeedy.length,
      pineNeedyList: pineNeedy.map((d) => ({ dramaId: d.dramaId, title: d.title, provider: 'pinedrama' })),
      meloloNeedyList: meloloNeedy.map((d) => ({ dramaId: d.book_id || d.dramaId, title: d.title, provider: 'melolo' })),
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/dramas/check-existing
 */
router.post('/dramas/check-existing', async (req: Request, res: Response) => {
  try {
    const { provider, collectionIds } = req.body;
    if (!Array.isArray(collectionIds) || collectionIds.length === 0) {
      return res.json({ success: true, existingMap: {} });
    }

    const existingMap: Record<string, any> = {};

    if (!provider || provider === 'all' || provider === 'pinedrama') {
      const pineDocs = await PineDramaDrama.find({
        $or: [{ dramaId: { $in: collectionIds } }, { collection_id: { $in: collectionIds } }],
      }).lean();

      for (const doc of pineDocs) {
        const id = doc.collection_id || doc.dramaId;
        existingMap[id] = {
          inDb: true,
          dbTotalEpisodes: doc.totalEpisodes || 0,
          dbSyncedEpisodes: doc.syncedEpisodesCount || 0,
          dbPendingEpisodes: doc.pendingEpisodesCount || 0,
          syncStatus: doc.syncStatus,
          importedAt: doc.importedAt,
          provider: 'pinedrama',
        };
      }
    }

    if (!provider || provider === 'all' || provider === 'melolo') {
      const meloloDocs = await MeloloDrama.find({
        $or: [{ book_id: { $in: collectionIds } }, { collection_id: { $in: collectionIds } }, { dramaId: { $in: collectionIds } }],
      }).lean();

      for (const doc of meloloDocs) {
        const id = doc.book_id || doc.collection_id || doc.dramaId;
        existingMap[id] = {
          inDb: true,
          dbTotalEpisodes: doc.totalEpisodes || 0,
          dbSyncedEpisodes: doc.syncedEpisodesCount || 0,
          dbPendingEpisodes: doc.pendingEpisodesCount || 0,
          syncStatus: doc.syncStatus,
          importedAt: doc.importedAt,
          provider: 'melolo',
        };
      }
    }

    res.json({ success: true, existingMap });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/proxy-image
 */
router.get('/proxy-image', async (req: Request, res: Response) => {
  try {
    const imageUrl = req.query.url as string;
    if (!imageUrl || typeof imageUrl !== 'string') {
      return res.status(400).send('Missing url parameter');
    }

    const response = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 15000,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        Referer: '',
      },
    });

    const contentType = (response.headers['content-type'] as string) || 'image/jpeg';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(Buffer.from(response.data));
  } catch (err: any) {
    res.redirect('https://placehold.co/400x600/1e293b/cbd5e1?text=No+Cover');
  }
});

/**
 * GET /api/proxy-sansekai
 * Proxy fallback for browser requests to Sansekai API to guarantee valid JSON responses (never HTML)
 */
router.get('/proxy-sansekai', async (req: Request, res: Response) => {
  try {
    let targetUrl = req.query.url as string;
    if (!targetUrl) {
      return res.status(400).json({ success: false, error: 'Query parameter "url" is required' });
    }

    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
      if (targetUrl.startsWith('/')) {
        targetUrl = `https://api.sansekai.my.id${targetUrl}`;
      } else {
        targetUrl = `https://api.sansekai.my.id/api/${targetUrl}`;
      }
    }

    const queryParams: Record<string, any> = { ...req.query };
    delete queryParams.url;

    const sansekaiRes = await axios.get(targetUrl, {
      params: queryParams,
      timeout: 25000,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        Accept: 'application/json, text/plain, */*',
        'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
      },
    });

    res.setHeader('Content-Type', 'application/json');
    res.json(sansekaiRes.data);
  } catch (err: any) {
    const status = err.response?.status || 500;
    const dataSnippet = err.response?.data || err.message;
    res.status(status).json({
      success: false,
      error: `Proxy error: ${err.message}`,
      status,
      dataSnippet,
    });
  }
});

/**
 * GET /api/dramas/melolo-needing-fix
 */
router.get('/dramas/melolo-needing-fix', async (_req: Request, res: Response) => {
  try {
    const meloloDramas = await MeloloDrama.find().lean();

    const needy = meloloDramas.filter((d: any) => {
      const hasNoCover = !d.coverUrl || d.coverUrl.includes('placehold.co') || d.coverUrl.trim() === '';
      const hasDefaultCat =
        !d.categories ||
        d.categories.length === 0 ||
        d.categories.some((c: string) => c === 'Melolo Short Drama' || c === 'General');
      const hasDefaultEps = !d.totalEpisodes || d.totalEpisodes === 30 || d.syncedEpisodesCount === 0;

      return hasNoCover || hasDefaultCat || hasDefaultEps || !d.hasSynopsis;
    });

    res.json({
      success: true,
      count: needy.length,
      dramas: needy.map((d: any) => ({
        dramaId: d.book_id || d.collection_id || d.dramaId,
        collection_id: d.book_id || d.collection_id || d.dramaId,
        title: d.title,
        coverUrl: d.coverUrl,
        categories: d.categories,
        totalEpisodes: d.totalEpisodes,
        provider: 'melolo',
      })),
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/dramas/update-melolo-detail
 * Enriches MeloloDrama and MeloloEpisode documents in melolo_* collections
 */
router.post('/dramas/update-melolo-detail', async (req: Request, res: Response) => {
  try {
    const { rawDetail, collection_id: customId } = req.body;
    if (!rawDetail) {
      return res.status(400).json({ success: false, error: 'Missing rawDetail payload' });
    }

    const normalized = normalizeMeloloDetail(rawDetail);
    const collectionId = normalized.collection_id || customId;

    if (!collectionId) {
      return res.status(400).json({ success: false, error: 'Could not resolve collection_id for Melolo drama' });
    }

    let drama = await MeloloDrama.findOne({
      $or: [{ book_id: collectionId }, { collection_id: collectionId }, { dramaId: collectionId }],
    });

    if (!drama) {
      drama = new MeloloDrama({
        book_id: collectionId,
        collection_id: collectionId,
        dramaId: collectionId,
        title: normalized.title,
        coverUrl: normalized.coverUrl,
        synopsis: normalized.synopsis,
        hasSynopsis: Boolean(normalized.synopsis && normalized.synopsis.trim().length > 0),
        categories: normalized.categories,
        totalEpisodes: normalized.totalEpisodes,
        syncedEpisodesCount: 0,
        pendingEpisodesCount: normalized.totalEpisodes,
        syncStatus: 'PENDING_EPISODES',
        source: 'Melolo Detail Enrich',
        isNewlyAdded: true,
        importedAt: new Date(),
        lastSyncedAt: new Date(),
      });
    } else {
      if (normalized.coverUrl && !normalized.coverUrl.includes('placehold.co')) {
        drama.coverUrl = normalized.coverUrl;
      }
      if (normalized.title && !drama.title.includes('Om-om') && normalized.title !== drama.title) {
        drama.title = normalized.title;
      }
      if (normalized.synopsis) {
        drama.synopsis = normalized.synopsis;
        drama.hasSynopsis = true;
      }

      const filteredCats = normalized.categories.filter((c) => c !== 'Melolo Short Drama' && c !== 'General');
      if (filteredCats.length > 0) {
        drama.categories = filteredCats;
      }

      if (normalized.totalEpisodes > drama.totalEpisodes) {
        drama.totalEpisodes = normalized.totalEpisodes;
      }
      drama.lastSyncedAt = new Date();
    }

    await drama.save();

    // Insert/Update Episode documents with video_id (vid) into melolo_episodes collection
    if (Array.isArray(normalized.video_list) && normalized.video_list.length > 0) {
      for (const v of normalized.video_list) {
        const epNum = v.episodeNumber;
        const vid = v.video_id;

        await MeloloEpisode.findOneAndUpdate(
          {
            $or: [{ book_id: collectionId }, { collection_id: collectionId }, { dramaId: collectionId }],
            episodeNumber: epNum,
          },
          {
            book_id: collectionId,
            collection_id: collectionId,
            dramaId: collectionId,
            episodeNumber: epNum,
            video_id: vid || null,
            title: v.title || `Episode ${epNum}`,
            episodeCover: v.cover || drama.coverUrl,
            duration: v.duration || 0,
          },
          { upsert: true }
        );
      }
    }

    await syncWorker.recalculateDramaCounts(collectionId, 'melolo');

    // Upsert Categories to melolo_categories
    for (const catName of drama.categories) {
      const slug = catName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const count = await MeloloDrama.countDocuments({ categories: catName });
      await MeloloCategory.findOneAndUpdate(
        { categoryId: slug },
        {
          categoryId: slug,
          name: catName,
          slug,
          totalTitles: count,
          lastSyncedAt: new Date(),
        },
        { upsert: true }
      );
    }

    res.json({
      success: true,
      message: `Enriched Melolo drama "${drama.title}" with ${normalized.video_list?.length || 0} episodes in melolo_episodes!`,
      drama,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/dramas/resync-detail
 * Enriches details/synopsis for either PineDrama or Melolo
 */
router.post('/api/dramas/resync-detail', async (req: Request, res: Response) => {
  try {
    const { provider, dramaId, title, synopsis, coverUrl, categories } = req.body;
    const targetProvider = provider === 'melolo' ? 'melolo' : 'pinedrama';
    const DramaModel = getDramaModel(targetProvider);

    const filter = { $or: [{ dramaId }, { collection_id: dramaId }, { book_id: dramaId }] };
    const doc = await DramaModel.findOne(filter);

    if (doc) {
      if (title) doc.title = title;
      if (synopsis) {
        doc.synopsis = synopsis;
        if ('hasSynopsis' in doc) (doc as any).hasSynopsis = true;
      }
      if (coverUrl) doc.coverUrl = coverUrl;
      if (Array.isArray(categories) && categories.length > 0) doc.categories = categories;
      doc.lastSyncedAt = new Date();
      await doc.save();
    }

    res.json({ success: true, message: `Updated detail for ${dramaId} in ${targetProvider}` });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * PUT /api/dramas/:provider/:dramaId
 * Edit Drama manually (Title, Synopsis, Cover URL, Categories)
 */
router.put('/dramas/:provider/:dramaId', async (req: Request, res: Response) => {
  try {
    const { provider, dramaId } = req.params;
    const { title, synopsis, coverUrl, categories } = req.body;
    const targetProvider = provider === 'melolo' ? 'melolo' : 'pinedrama';
    const DramaModel = getDramaModel(targetProvider);

    const filter = { $or: [{ dramaId }, { collection_id: dramaId }, { book_id: dramaId }] };
    const drama = await DramaModel.findOne(filter);

    if (!drama) {
      return res.status(404).json({ success: false, error: 'Drama not found' });
    }

    if (title !== undefined) drama.title = title;
    if (synopsis !== undefined) {
      drama.synopsis = synopsis;
      if ('hasSynopsis' in drama) (drama as any).hasSynopsis = Boolean(synopsis && synopsis.trim().length > 0);
    }
    if (coverUrl !== undefined) drama.coverUrl = coverUrl;
    if (Array.isArray(categories)) drama.categories = categories;
    drama.lastSyncedAt = new Date();

    await drama.save();

    res.json({ success: true, message: `Drama ${dramaId} updated successfully`, drama });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * DELETE /api/dramas/:provider/:dramaId
 * Deletes drama document AND all associated episode documents from provider's collection
 */
router.delete('/dramas/:provider/:dramaId', async (req: Request, res: Response) => {
  try {
    const { provider, dramaId } = req.params;
    const targetProvider = provider === 'melolo' ? 'melolo' : 'pinedrama';
    const DramaModel = getDramaModel(targetProvider);
    const EpisodeModel = getEpisodeModel(targetProvider);

    const filter = { $or: [{ dramaId }, { collection_id: dramaId }, { book_id: dramaId }] };

    const deletedDrama = await DramaModel.findOneAndDelete(filter);
    const deletedEps = await EpisodeModel.deleteMany(filter);

    res.json({
      success: true,
      message: `Deleted drama "${deletedDrama?.title || dramaId}" and ${deletedEps.deletedCount} episodes from ${targetProvider} collections.`,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * PUT /api/episodes/:provider/:dramaId/:episodeNumber
 * Edit manual episode stream URL and video_id
 */
router.put('/episodes/:provider/:dramaId/:episodeNumber', async (req: Request, res: Response) => {
  try {
    const { provider, dramaId, episodeNumber } = req.params;
    const { streamUrl, video_id, title, quality } = req.body;
    const epNum = parseInt(episodeNumber, 10);
    const targetProvider = provider === 'melolo' ? 'melolo' : 'pinedrama';
    const EpisodeModel = getEpisodeModel(targetProvider);

    const filter = targetProvider === 'melolo'
      ? { $or: [{ book_id: dramaId }, { collection_id: dramaId }, { dramaId }], episodeNumber: epNum }
      : { $or: [{ collection_id: dramaId }, { dramaId }], episodeNumber: epNum };

    const update: any = {
      provider: targetProvider,
      collection_id: dramaId,
      dramaId,
      streamUrl: streamUrl || null,
      bestUrl: streamUrl || null,
      video_id: video_id || null,
      syncStatus: streamUrl ? 'SYNCED' : 'PENDING',
      lastSyncedAt: new Date(),
    };

    if (targetProvider === 'melolo') {
      update.book_id = dramaId;
    }

    if (title) update.title = title;
    if (quality) update.quality = quality;
    if (streamUrl) update.backupUrls = [streamUrl];

    const episode = await EpisodeModel.findOneAndUpdate(filter, update, { upsert: true, new: true, strict: false });
    await syncWorker.recalculateDramaCounts(dramaId, targetProvider);

    res.json({ success: true, message: `Episode ${epNum} updated successfully`, episode });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * DELETE /api/episodes/:provider/:dramaId/:episodeNumber/reset
 * Resets episode stream URL to pending
 */
router.delete('/episodes/:provider/:dramaId/:episodeNumber/reset', async (req: Request, res: Response) => {
  try {
    const { provider, dramaId, episodeNumber } = req.params;
    const epNum = parseInt(episodeNumber, 10);
    const targetProvider = provider === 'melolo' ? 'melolo' : 'pinedrama';
    const EpisodeModel = getEpisodeModel(targetProvider);

    const filter = {
      $or: [{ dramaId }, { collection_id: dramaId }, { book_id: dramaId }],
      episodeNumber: epNum,
    };

    const episode = await EpisodeModel.findOneAndUpdate(
      filter,
      {
        streamUrl: null,
        bestUrl: null,
        qualities: [],
        backupUrls: [],
        syncStatus: 'PENDING',
        errorMessage: null,
      },
      { new: true }
    );

    await syncWorker.recalculateDramaCounts(dramaId, targetProvider);

    res.json({ success: true, message: `Episode ${epNum} reset to PENDING`, episode });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/admin/cleanup-melolo-in-pinedrama
 * Purges any Melolo contamination remaining in pinedrama_* collections
 */
router.post('/admin/cleanup-melolo-in-pinedrama', async (_req: Request, res: Response) => {
  try {
    const result = await runMigrationAndCleanup();
    res.json({
      success: true,
      message: `Cleaned up contamination! Migrated ${result.migratedDramas} dramas, ${result.migratedEpisodes} episodes, ${result.migratedCategories} categories to melolo_* collections and purged from pinedrama_*!`,
      result,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * DELETE /api/admin/purge-provider-data
 * Bulk Cleanup by Provider, Tag/Category, or Reset Pending Episodes
 */
router.delete('/admin/purge-provider-data', async (req: Request, res: Response) => {
  try {
    const { provider, actionTarget, categoryName } = req.body;
    const targetProvider = provider === 'melolo' ? 'melolo' : 'pinedrama';
    const DramaModel = getDramaModel(targetProvider);
    const EpisodeModel = getEpisodeModel(targetProvider);
    const CategoryModel = getCategoryModel(targetProvider);

    if (actionTarget === 'purge_all_dramas') {
      const dramaDel = await DramaModel.deleteMany({});
      const epDel = await EpisodeModel.deleteMany({});
      await CategoryModel.deleteMany({});

      return res.json({
        success: true,
        message: `Purged ALL ${targetProvider.toUpperCase()} data (${dramaDel.deletedCount} dramas, ${epDel.deletedCount} episodes).`,
      });
    }

    if (actionTarget === 'reset_all_pending') {
      const resetRes = await EpisodeModel.updateMany(
        { syncStatus: 'FAILED' },
        { syncStatus: 'PENDING', errorMessage: null }
      );
      return res.json({
        success: true,
        message: `Reset ${resetRes.modifiedCount} failed episodes in ${targetProvider.toUpperCase()} to PENDING.`,
      });
    }

    if (actionTarget === 'delete_by_category' && categoryName) {
      const dramasToDelete = await DramaModel.find({ categories: categoryName }).lean();
      const ids = dramasToDelete.map((d: any) => d.book_id || d.collection_id || d.dramaId);

      const epDel = await EpisodeModel.deleteMany({
        $or: [{ dramaId: { $in: ids } }, { collection_id: { $in: ids } }, { book_id: { $in: ids } }],
      });
      const dramaDel = await DramaModel.deleteMany({ categories: categoryName });
      await CategoryModel.deleteMany({ name: categoryName });

      return res.json({
        success: true,
        message: `Deleted category "${categoryName}" (${dramaDel.deletedCount} dramas, ${epDel.deletedCount} episodes) from ${targetProvider.toUpperCase()}.`,
      });
    }

    return res.status(400).json({ success: false, error: 'Invalid purge parameters' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/sync/import-dramas
 * Import dramas into provider-isolated collections
 */
router.post('/sync/import-dramas', async (req: Request, res: Response) => {
  try {
    const { provider, dramas, source } = req.body;
    const targetProvider = provider === 'melolo' ? 'melolo' : 'pinedrama';
    const DramaModel = getDramaModel(targetProvider);
    const EpisodeModel = getEpisodeModel(targetProvider);
    const CategoryModel = getCategoryModel(targetProvider);

    if (!Array.isArray(dramas) || dramas.length === 0) {
      return res.status(400).json({ success: false, error: 'No dramas provided to import.' });
    }

    const importSource = source || `${targetProvider.toUpperCase()} Explorer`;
    const newlyAddedList: any[] = [];
    let totalNewEpisodesAdded = 0;
    const categoriesFound = new Set<string>();

    for (const rawItem of dramas) {
      const normalized = normalizeDramaItem(rawItem, targetProvider, importSource);
      const collectionId = normalized.collection_id;
      if (!collectionId || !normalized.title) continue;

      normalized.categories.forEach((c) => categoriesFound.add(c));
      const totalEps = normalized.totalEpisodes;

      const existingDrama = await DramaModel.findOne({
        $or: [{ dramaId: collectionId }, { collection_id: collectionId }, { book_id: collectionId }],
      });

      if (!existingDrama) {
        const createDoc: any = {
          book_id: collectionId,
          collection_id: collectionId,
          dramaId: collectionId,
          title: normalized.title,
          coverUrl: normalized.coverUrl,
          synopsis: normalized.synopsis,
          categories: normalized.categories,
          totalEpisodes: totalEps,
          syncedEpisodesCount: 0,
          pendingEpisodesCount: totalEps,
          syncStatus: 'PENDING_EPISODES',
          source: importSource,
          isNewlyAdded: true,
          importedAt: new Date(),
          lastSyncedAt: new Date(),
        };
        if (targetProvider === 'melolo') {
          createDoc.hasSynopsis = Boolean(normalized.synopsis && normalized.synopsis.trim().length > 0);
        }

        await DramaModel.create(createDoc);

        // Skeleton / Full Episode docs creation
        const epDocs = [];
        if (Array.isArray(normalized.video_list) && normalized.video_list.length > 0) {
          normalized.video_list.forEach((v: any, idx: number) => {
            const epNum = v.vid_index || v.episodeNumber || idx + 1;
            const vid = v.vid || v.video_id || null;

            epDocs.push({
              book_id: collectionId,
              collection_id: collectionId,
              dramaId: collectionId,
              episodeNumber: epNum,
              video_id: vid,
              title: v.title || `Episode ${epNum}`,
              episodeCover: v.cover || normalized.coverUrl,
              duration: v.duration || 0,
              streamUrl: null,
              syncStatus: 'PENDING',
              errorMessage: null,
            });
          });
        } else {
          for (let i = 1; i <= totalEps; i++) {
            epDocs.push({
              book_id: collectionId,
              collection_id: collectionId,
              dramaId: collectionId,
              episodeNumber: i,
              title: `Episode ${i}`,
              streamUrl: null,
              syncStatus: 'PENDING',
              errorMessage: null,
            });
          }
        }

        if (epDocs.length > 0) {
          await EpisodeModel.insertMany(epDocs, { ordered: false }).catch(() => {});
        }

        newlyAddedList.push({
          provider: targetProvider,
          dramaId: collectionId,
          title: normalized.title,
          coverUrl: normalized.coverUrl,
          totalEpisodes: totalEps,
          categories: normalized.categories,
        });
        totalNewEpisodesAdded += totalEps;
      } else {
        // Update existing
        existingDrama.coverUrl = normalized.coverUrl || existingDrama.coverUrl;
        if (normalized.synopsis) {
          existingDrama.synopsis = normalized.synopsis;
          if ('hasSynopsis' in existingDrama) (existingDrama as any).hasSynopsis = true;
        }
        existingDrama.categories = Array.from(new Set([...existingDrama.categories, ...normalized.categories]));

        if (totalEps > existingDrama.totalEpisodes) {
          const diff = totalEps - existingDrama.totalEpisodes;
          existingDrama.totalEpisodes = totalEps;

          const epDocs = [];
          for (let i = existingDrama.totalEpisodes + 1; i <= totalEps; i++) {
            epDocs.push({
              book_id: collectionId,
              collection_id: collectionId,
              dramaId: collectionId,
              episodeNumber: i,
              title: `Episode ${i}`,
              streamUrl: null,
              syncStatus: 'PENDING',
              errorMessage: null,
            });
          }
          if (epDocs.length > 0) {
            await EpisodeModel.insertMany(epDocs, { ordered: false }).catch(() => {});
          }
          totalNewEpisodesAdded += diff;
        }
        await existingDrama.save();
      }
    }

    // Upsert Categories
    for (const catName of categoriesFound) {
      const slug = catName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const count = await DramaModel.countDocuments({ categories: catName });
      await CategoryModel.findOneAndUpdate(
        { categoryId: slug },
        {
          categoryId: slug,
          name: catName,
          slug,
          totalTitles: count,
          lastSyncedAt: new Date(),
        },
        { upsert: true }
      );
    }

    // Log newly added
    if (newlyAddedList.length > 0) {
      await NewlyAddedLog.create({
        provider: targetProvider,
        source: importSource,
        totalImported: newlyAddedList.length,
        totalNewEpisodes: totalNewEpisodesAdded,
        dramas: newlyAddedList,
        importedAt: new Date(),
      });

      await syncWorker.addLog(
        `✅ [${targetProvider.toUpperCase()} IMPORTED] ${newlyAddedList.length} new titles (+${totalNewEpisodesAdded} pending episodes) saved to ${targetProvider}_dramas.`
      );
    }

    res.json({
      success: true,
      message: `Imported ${newlyAddedList.length} new dramas (+${totalNewEpisodesAdded} episodes) to ${targetProvider}.`,
      importedCount: newlyAddedList.length,
      totalNewEpisodes: totalNewEpisodesAdded,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/sync/newly-added
 */
router.get('/sync/newly-added', async (req: Request, res: Response) => {
  try {
    const { provider } = req.query;
    const filter: any = {};
    if (provider && provider !== 'all') {
      filter.provider = provider as string;
    }

    const logs = await NewlyAddedLog.find(filter).sort({ importedAt: -1 }).limit(30);
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
    const { provider } = req.query;

    const filter = { $or: [{ dramaId }, { collection_id: dramaId }, { book_id: dramaId }] };

    let drama: any = null;
    let targetProvider = (provider as string) || 'pinedrama';

    if (targetProvider === 'melolo') {
      drama = await MeloloDrama.findOne(filter).lean();
      if (drama) drama.provider = 'melolo';
    } else if (targetProvider === 'pinedrama') {
      drama = await PineDramaDrama.findOne(filter).lean();
      if (drama) drama.provider = 'pinedrama';
    } else {
      drama = await PineDramaDrama.findOne(filter).lean();
      if (drama) {
        drama.provider = 'pinedrama';
      } else {
        drama = await MeloloDrama.findOne(filter).lean();
        if (drama) drama.provider = 'melolo';
      }
    }

    if (!drama) {
      return res.status(404).json({ success: false, error: 'Drama not found' });
    }

    const EpisodeModel = getEpisodeModel(drama.provider);
    const episodes = await EpisodeModel.find(filter).sort({ episodeNumber: 1 }).lean();

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
 * GET /api/dramas/:provider/:id/episodes
 * Returns drama details and all associated episodes for a specific provider
 */
router.get('/dramas/:provider/:id/episodes', async (req: Request, res: Response) => {
  try {
    const { provider, id } = req.params;
    const targetProvider = provider === 'melolo' ? 'melolo' : 'pinedrama';

    const filter = { $or: [{ dramaId: id }, { collection_id: id }, { book_id: id }] };
    const DramaModel = getDramaModel(targetProvider);
    const EpisodeModel = getEpisodeModel(targetProvider);

    const drama = await DramaModel.findOne(filter).lean();
    if (!drama) {
      return res.status(404).json({ success: false, error: 'Drama not found' });
    }

    const episodes = await EpisodeModel.find(filter).sort({ episodeNumber: 1 }).lean();

    res.json({
      success: true,
      drama: { ...drama, provider: targetProvider },
      count: episodes.length,
      episodes,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/sync/next-pending-episodes
 * Returns next pending episodes across provider queues
 */
router.get('/sync/next-pending-episodes', async (req: Request, res: Response) => {
  try {
    const limit = parseInt((req.query.limit as string) || '10', 10);
    const collectionId = req.query.collection_id as string;
    const provider = (req.query.provider as string) || 'all';

    const formatted: any[] = [];

    const fetchPendingFrom = async (prov: 'pinedrama' | 'melolo') => {
      const EpisodeModel = getEpisodeModel(prov);
      const DramaModel = getDramaModel(prov);

      const filter: any = { syncStatus: { $in: ['PENDING', 'FAILED'] } };
      if (collectionId) {
        filter.$or = [{ dramaId: collectionId }, { collection_id: collectionId }, { book_id: collectionId }];
      }

      const list = await EpisodeModel.find(filter)
        .sort({ dramaId: 1, episodeNumber: 1 })
        .limit(limit)
        .lean();

      for (const ep of list) {
        const id = ep.book_id || ep.collection_id || ep.dramaId;
        const dramaDoc = await DramaModel.findOne({ $or: [{ dramaId: id }, { collection_id: id }, { book_id: id }] }).lean();

        formatted.push({
          provider: prov,
          dramaId: id,
          collection_id: id,
          episodeNumber: ep.episodeNumber,
          video_id: ep.video_id || null,
          title: ep.title || `Episode ${ep.episodeNumber}`,
          dramaTitle: dramaDoc?.title || id,
          coverUrl: dramaDoc?.coverUrl || '',
        });
      }
    };

    if (provider === 'melolo') {
      await fetchPendingFrom('melolo');
    } else if (provider === 'pinedrama') {
      await fetchPendingFrom('pinedrama');
    } else {
      // 'all' or 'alternating'
      await fetchPendingFrom('melolo');
      if (formatted.length < limit) {
        await fetchPendingFrom('pinedrama');
      }
    }

    res.json({ success: true, count: formatted.length, pendingEpisodes: formatted.slice(0, limit) });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/sync/save-episode
 * Saves episode stream data into isolated collection
 */
router.post('/sync/save-episode', async (req: Request, res: Response) => {
  try {
    const { provider, collection_id, dramaId, episodeNumber, video_id, rawResponse, syncStatus, errorMessage, streamUrl, qualities } = req.body;
    const targetProvider = provider === 'melolo' ? 'melolo' : 'pinedrama';
    const targetDramaId = collection_id || dramaId;
    const epNum = parseInt(episodeNumber, 10);

    if (!targetDramaId || isNaN(epNum)) {
      return res.status(400).json({ success: false, error: 'collection_id and episodeNumber required' });
    }

    const EpisodeModel = getEpisodeModel(targetProvider);
    const DramaModel = getDramaModel(targetProvider);

    const epFilter = targetProvider === 'melolo'
      ? { $or: [{ book_id: targetDramaId }, { collection_id: targetDramaId }, { dramaId: targetDramaId }], episodeNumber: epNum }
      : { $or: [{ collection_id: targetDramaId }, { dramaId: targetDramaId }], episodeNumber: epNum };

    if (rawResponse) {
      const normalized = normalizeEpisodeResponse(rawResponse, targetProvider, epNum);
      const status = normalized.best_url ? 'SYNCED' : 'FAILED';
      const err = normalized.error || errorMessage || null;

      const updatePayload: any = {
        provider: targetProvider,
        collection_id: targetDramaId,
        dramaId: targetDramaId,
        episodeNumber: epNum,
        video_id: normalized.video_id || video_id || null,
        title: normalized.title,
        bestUrl: normalized.best_url,
        streamUrl: normalized.best_url,
        quality: normalized.quality || '720p',
        backupUrls: normalized.backup_urls,
        syncStatus: status,
        errorMessage: err,
        lastSyncedAt: new Date(),
      };

      if (targetProvider === 'melolo') {
        updatePayload.book_id = targetDramaId;
        if (rawResponse.qualities) {
          updatePayload.qualities = rawResponse.qualities;
        }
      } else {
        delete updatePayload.book_id;
      }

      await EpisodeModel.findOneAndUpdate(epFilter, updatePayload, { upsert: true, new: true, strict: false });
      await syncWorker.recalculateDramaCounts(targetDramaId, targetProvider);

      const dramaDoc = await DramaModel.findOne(
        targetProvider === 'melolo'
          ? { $or: [{ book_id: targetDramaId }, { collection_id: targetDramaId }, { dramaId: targetDramaId }] }
          : { $or: [{ collection_id: targetDramaId }, { dramaId: targetDramaId }] }
      );
      const dramaTitle = dramaDoc ? dramaDoc.title : targetDramaId;

      if (normalized.best_url) {
        await syncWorker.addLog(`✔ [${targetProvider.toUpperCase()} SYNCED] "${dramaTitle}" Ep ${epNum} -> ${normalized.best_url.slice(0, 45)}...`);
      } else {
        await syncWorker.addLog(`✖ [${targetProvider.toUpperCase()} FAILED] "${dramaTitle}" Ep ${epNum}: ${err || 'No stream URL'}`);
      }

      return res.json({ success: true, message: `Episode ${epNum} saved.` });
    } else {
      const finalUrl = streamUrl || null;
      const status = syncStatus || (finalUrl ? 'SYNCED' : 'FAILED');

      const updatePayload: any = {
        provider: targetProvider,
        collection_id: targetDramaId,
        dramaId: targetDramaId,
        episodeNumber: epNum,
        video_id: video_id || null,
        bestUrl: finalUrl,
        streamUrl: finalUrl,
        backupUrls: finalUrl ? [finalUrl] : [],
        syncStatus: status,
        errorMessage: errorMessage || null,
        lastSyncedAt: new Date(),
      };

      if (targetProvider === 'melolo') {
        updatePayload.book_id = targetDramaId;
        if (Array.isArray(qualities)) {
          updatePayload.qualities = qualities;
        }
      } else {
        delete updatePayload.book_id;
      }

      await EpisodeModel.findOneAndUpdate(epFilter, updatePayload, { upsert: true, new: true, strict: false });
      await syncWorker.recalculateDramaCounts(targetDramaId, targetProvider);

      return res.json({ success: true, message: `Episode ${epNum} updated.` });
    }
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/sync/status
 */
router.get('/sync/status', async (req: Request, res: Response) => {
  try {
    const { provider } = req.query;
    const targetProvider = (provider as string) || 'all';
    const state = await syncWorker.getState();

    let totalCategories = 0;
    let totalDramas = 0;
    let syncedEpisodes = 0;
    let pendingEpisodes = 0;

    if (targetProvider === 'all' || targetProvider === 'pinedrama') {
      totalCategories += await PineDramaCategory.countDocuments();
      totalDramas += await PineDramaDrama.countDocuments();
      syncedEpisodes += await PineDramaEpisode.countDocuments({ syncStatus: 'SYNCED' });
      pendingEpisodes += await PineDramaEpisode.countDocuments({ syncStatus: { $ne: 'SYNCED' } });
    }

    if (targetProvider === 'all' || targetProvider === 'melolo') {
      totalCategories += await MeloloCategory.countDocuments();
      totalDramas += await MeloloDrama.countDocuments();
      syncedEpisodes += await MeloloEpisode.countDocuments({ syncStatus: 'SYNCED' });
      pendingEpisodes += await MeloloEpisode.countDocuments({ syncStatus: { $ne: 'SYNCED' } });
    }

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
 * POST /api/test-endpoint
 */
router.post('/test-endpoint', async (req: Request, res: Response) => {
  try {
    const { endpointPath, params } = req.body;
    if (!endpointPath) {
      return res.status(400).json({ success: false, error: 'Endpoint path required' });
    }

    const testRes: any = await sansekaiApi.testEndpoint(endpointPath, params || {});
    res.json({
      success: true,
      status: testRes.status,
      fullUrl: testRes.fullUrl,
      headers: testRes.headers,
      data: testRes.data,
    });
  } catch (err: any) {
    const errInfo = sansekaiApi.formatError(err);
    res.json({
      success: false,
      error: errInfo.message,
      status: errInfo.status,
      fullUrl: errInfo.fullUrl,
      dataSnippet: errInfo.dataSnippet,
    });
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

/**
 * POST /api/drive/auto-backup
 * Background uploader to pipe video stream directly to Google Drive
 */
router.post('/drive/auto-backup', async (req: Request, res: Response) => {
  try {
    const { dramaId, provider = 'pinedrama', episodeNumber, streamUrl, dramaTitle, force = false, forceResync = false } = req.body;
    const isForce = Boolean(force || forceResync);

    if (!dramaId || !episodeNumber || !streamUrl) {
      return res.status(400).json({
        success: false,
        error: 'dramaId, episodeNumber, and streamUrl are required',
      });
    }

    const targetProvider = provider === 'melolo' ? 'melolo' : 'pinedrama';
    let title = dramaTitle;

    if (!title) {
      const DramaModel = getDramaModel(targetProvider);
      const dramaDoc = await DramaModel.findOne({
        $or: [{ dramaId }, { collection_id: dramaId }, { book_id: dramaId }],
      }).lean();
      title = dramaDoc?.title || dramaDoc?.book_name || `Drama_${dramaId}`;
    }

    // Ensure folder hierarchy in Google Drive
    const folderId = await getDramaFolder(targetProvider, title);

    const fileName = `${targetProvider}_${dramaId}_ep${episodeNumber}.mp4`;
    const uploadRes = await uploadVideoFromUrl(streamUrl, fileName, folderId, isForce);

    // Update episode in MongoDB
    const EpisodeModel = getEpisodeModel(targetProvider);
    const epFilter = targetProvider === 'melolo'
      ? { $or: [{ book_id: dramaId }, { collection_id: dramaId }, { dramaId }], episodeNumber: Number(episodeNumber) }
      : { $or: [{ collection_id: dramaId }, { dramaId }], episodeNumber: Number(episodeNumber) };

    const updatePayload: any = {
      gdriveFileId: uploadRes.fileId,
      gdriveViewLink: uploadRes.webViewLink,
      gdriveDirectLink: uploadRes.gdriveDirectLink,
      syncStatus: 'BACKED_UP_GDRIVE',
      lastSyncedAt: new Date(),
    };

    const updatedEp = await EpisodeModel.findOneAndUpdate(
      epFilter,
      { $set: updatePayload },
      { new: true, upsert: true, strict: false }
    );

    res.json({
      success: true,
      message: `Episode ${episodeNumber} auto-backed up to Google Drive.`,
      data: {
        fileId: uploadRes.fileId,
        webViewLink: uploadRes.webViewLink,
        gdriveDirectLink: uploadRes.gdriveDirectLink,
        episode: updatedEp,
      },
    });
  } catch (err: any) {
    console.error('[Drive Auto-Backup Error]:', err);
    const errorDescription =
      err.response?.data?.error_description ||
      (typeof err.response?.data?.error === 'string'
        ? err.response?.data?.error
        : err.response?.data?.error?.message) ||
      err.message;
    const fullErrorStack = err.stack || (err.response?.data ? JSON.stringify(err.response.data, null, 2) : '');

    res.status(500).json({
      success: false,
      error: errorDescription,
      details: fullErrorStack,
    });
  }
});

/**
 * GET /api/drive/episodes
 * Fetch episodes with GDrive backup status, mock detection, search, and priority sorting
 */
router.get('/drive/episodes', async (req: Request, res: Response) => {
  try {
    const { provider = 'all', status = 'all', q = '', limit: customLimit } = req.query;
    const maxItems = Math.min(Number(customLimit) || 500, 1000);
    const searchQuery = typeof q === 'string' ? q.trim().toLowerCase() : '';

    let items: any[] = [];

    const fetchForProvider = async (prov: 'pinedrama' | 'melolo') => {
      const EpisodeModel = getEpisodeModel(prov);
      const DramaModel = getDramaModel(prov);

      let query: any = {};

      if (status === 'backed_up') {
        // Backed up properly (not null, not mock)
        query.gdriveFileId = { $exists: true, $ne: null, $not: /mock/i };
      } else if (status === 'mock') {
        // Explicitly mock data that needs force resync
        query.gdriveFileId = { $regex: 'mock', $options: 'i' };
      } else if (status === 'missing') {
        // Missing or mock
        query.$or = [
          { gdriveFileId: null },
          { gdriveFileId: { $exists: false } },
          { gdriveFileId: '' },
          { gdriveFileId: { $regex: 'mock', $options: 'i' } },
        ];
        query.streamUrl = { $ne: null };
      } else {
        // 'all': any episode with a stream URL or synced status
        query.$or = [
          { syncStatus: 'SYNCED' },
          { syncStatus: 'BACKED_UP_GDRIVE' },
          { streamUrl: { $ne: null } },
        ];
      }

      const eps = await EpisodeModel.find(query).sort({ updatedAt: -1 }).limit(maxItems).lean();
      const dramaIds = Array.from(new Set(eps.map((e: any) => e.dramaId || e.collection_id || e.book_id)));
      const dramas = await DramaModel.find({
        $or: [
          { dramaId: { $in: dramaIds } },
          { collection_id: { $in: dramaIds } },
          { book_id: { $in: dramaIds } },
        ],
      }).lean();

      const dramaMap = new Map<string, any>();
      dramas.forEach((d: any) => {
        const idKey = d.dramaId || d.collection_id || d.book_id;
        if (idKey) dramaMap.set(idKey, d);
      });

      return eps.map((ep: any) => {
        const idKey = ep.dramaId || ep.collection_id || ep.book_id;
        const parentDrama = dramaMap.get(idKey);
        const title = parentDrama?.title || parentDrama?.book_name || `Drama ${idKey}`;
        const isMock = Boolean(ep.gdriveFileId && String(ep.gdriveFileId).toLowerCase().includes('mock'));

        return {
          ...ep,
          provider: prov,
          dramaTitle: title,
          dramaCover: parentDrama?.coverUrl || parentDrama?.cover || parentDrama?.book_cover || '',
          isMock,
        };
      });
    };

    if (provider === 'all' || provider === 'pinedrama') {
      const pineEps = await fetchForProvider('pinedrama');
      items = items.concat(pineEps);
    }
    if (provider === 'all' || provider === 'melolo') {
      const meloloEps = await fetchForProvider('melolo');
      items = items.concat(meloloEps);
    }

    // Optional text filter
    if (searchQuery) {
      items = items.filter((item) =>
        item.dramaTitle.toLowerCase().includes(searchQuery) ||
        String(item.dramaId || item.collection_id || '').toLowerCase().includes(searchQuery)
      );
    }

    // Priority Sorting:
    // 1. Mock Data first (Priority 0)
    // 2. Missing GDrive backup second (Priority 1)
    // 3. Backed up properly third (Priority 2)
    items.sort((a, b) => {
      const getPriority = (item: any) => {
        if (item.isMock || (item.gdriveFileId && String(item.gdriveFileId).toLowerCase().includes('mock'))) return 0;
        if (!item.gdriveFileId) return 1;
        return 2;
      };

      const prioA = getPriority(a);
      const prioB = getPriority(b);
      if (prioA !== prioB) return prioA - prioB;

      // Secondary: dramaTitle alphabetical, then episodeNumber asc
      const titleCompare = (a.dramaTitle || '').localeCompare(b.dramaTitle || '');
      if (titleCompare !== 0) return titleCompare;
      return (a.episodeNumber || 0) - (b.episodeNumber || 0);
    });

    res.json({
      success: true,
      count: items.length,
      mockCount: items.filter((i) => i.isMock).length,
      missingCount: items.filter((i) => !i.gdriveFileId || i.isMock).length,
      items: items.slice(0, maxItems),
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/drive/backup-all-missing
 * Bulk backup missing episodes to Google Drive
 */
router.post('/drive/backup-all-missing', async (req: Request, res: Response) => {
  try {
    const { provider = 'all' } = req.body;

    const getMissing = async (prov: 'pinedrama' | 'melolo') => {
      const EpisodeModel = getEpisodeModel(prov);
      return EpisodeModel.find({
        streamUrl: { $ne: null },
        $or: [{ gdriveFileId: null }, { gdriveFileId: { $exists: false } }],
      }).lean();
    };

    let missingEps: any[] = [];
    if (provider === 'all' || provider === 'pinedrama') {
      const pineList = await getMissing('pinedrama');
      missingEps = missingEps.concat(pineList.map((e) => ({ ...e, provider: 'pinedrama' })));
    }
    if (provider === 'all' || provider === 'melolo') {
      const meloloList = await getMissing('melolo');
      missingEps = missingEps.concat(meloloList.map((e) => ({ ...e, provider: 'melolo' })));
    }

    if (missingEps.length === 0) {
      return res.json({ success: true, message: 'All synced episodes are already backed up to Google Drive!' });
    }

    // Process background backups
    (async () => {
      for (const ep of missingEps) {
        try {
          const prov = ep.provider;
          const dId = ep.dramaId || ep.collection_id || ep.book_id;
          const DramaModel = getDramaModel(prov);
          const dramaDoc = await DramaModel.findOne({
            $or: [{ dramaId: dId }, { collection_id: dId }, { book_id: dId }],
          }).lean();

          const title = dramaDoc?.title || dramaDoc?.book_name || `Drama_${dId}`;
          const folderId = await getDramaFolder(prov, title);
          const fileName = `${prov}_${dId}_ep${ep.episodeNumber}.mp4`;

          const uploadRes = await uploadVideoFromUrl(ep.streamUrl, fileName, folderId);

          const EpisodeModel = getEpisodeModel(prov);
          const epFilter = prov === 'melolo'
            ? { $or: [{ book_id: dId }, { collection_id: dId }, { dramaId: dId }], episodeNumber: ep.episodeNumber }
            : { $or: [{ collection_id: dId }, { dramaId: dId }], episodeNumber: ep.episodeNumber };

          await EpisodeModel.findOneAndUpdate(
            epFilter,
            {
              $set: {
                gdriveFileId: uploadRes.fileId,
                gdriveViewLink: uploadRes.webViewLink,
                gdriveDirectLink: uploadRes.gdriveDirectLink,
                syncStatus: 'BACKED_UP_GDRIVE',
                lastSyncedAt: new Date(),
              },
            },
            { strict: false }
          );
        } catch (err) {
          console.error(`[Bulk GDrive Backup] Error processing ep ${ep.episodeNumber}:`, err);
        }
      }
    })();

    res.json({
      success: true,
      message: `Started background backup for ${missingEps.length} missing episode(s).`,
      missingCount: missingEps.length,
    });
  } catch (err: any) {
    console.error('[Bulk GDrive Backup Endpoint Error]:', err);
    const errorDescription =
      err.response?.data?.error_description ||
      (typeof err.response?.data?.error === 'string'
        ? err.response?.data?.error
        : err.response?.data?.error?.message) ||
      err.message;
    res.status(500).json({
      success: false,
      error: errorDescription,
      details: err.stack || (err.response?.data ? JSON.stringify(err.response.data, null, 2) : ''),
    });
  }
});

export default router;

