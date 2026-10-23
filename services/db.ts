import mongoose from 'mongoose';
import { PineDramaDrama } from '../models/Drama.js';
import { PineDramaEpisode } from '../models/Episode.js';
import { PineDramaCategory } from '../models/Category.js';
import { MeloloDrama } from '../models/MeloloDrama.js';
import { MeloloEpisode } from '../models/MeloloEpisode.js';
import { MeloloCategory } from '../models/MeloloCategory.js';

const MONGODB_URI =
  process.env.MONGODB_URI ||
  'mongodb://fachrulwisnunovianto_db_user:%40BosskuBabi20@ac-jjfqkcv-shard-00-00.4sfcd75.mongodb.net:27017,ac-jjfqkcv-shard-00-01.4sfcd75.mongodb.net:27017,ac-jjfqkcv-shard-00-02.4sfcd75.mongodb.net:27017/?ssl=true&replicaSet=atlas-3mdncx-shard-0&authSource=admin';

let isConnected = false;
let connectionPromise: Promise<typeof mongoose> | null = null;
let hasMigrated = false;

export async function connectDB(): Promise<typeof mongoose> {
  if (mongoose.connection.readyState === 1) {
    isConnected = true;
    return mongoose;
  }

  if (connectionPromise) {
    return connectionPromise;
  }

  connectionPromise = (async () => {
    try {
      mongoose.set('strictQuery', false);
      const conn = await mongoose.connect(MONGODB_URI, {
        dbName: 'dracin_db',
        serverSelectionTimeoutMS: 15000,
      });
      isConnected = true;
      console.log(`[MongoDB] Berhasil terhubung ke Atlas (Host: ${conn.connection.host}, database: dracin_db)`);

      // Jalankan migrasi HANYA SETELAH koneksi Mongoose benar-benar berstatus connected (readyState === 1)
      if (!hasMigrated && mongoose.connection.readyState === 1) {
        hasMigrated = true;
        runMigrationAndCleanup().catch((err) => {
          console.error('[MongoDB Migration] Gagal saat startup cleanup:', err.message);
        });
      }

      return conn;
    } catch (error: any) {
      connectionPromise = null;
      isConnected = false;
      console.error('[MongoDB] Gagal terhubung:', error.message);
      throw error;
    }
  })();

  return connectionPromise;
}

/**
 * Migrates any Melolo contamination out of `pinedrama_*` collections into `melolo_*` collections,
 * then purges the contaminated records from `pinedrama_*`.
 */
export async function runMigrationAndCleanup(): Promise<{
  migratedDramas: number;
  migratedEpisodes: number;
  migratedCategories: number;
}> {
  let migratedDramas = 0;
  let migratedEpisodes = 0;
  let migratedCategories = 0;

  // Pastikan koneksi Mongoose sudah benar-benar readyState === 1 (connected)
  if (mongoose.connection.readyState !== 1) {
    console.warn('[MongoDB Migration] Dibatalkan: Mongoose belum berstatus connected.');
    return { migratedDramas: 0, migratedEpisodes: 0, migratedCategories: 0 };
  }

  try {
    // 1. Find contaminated Melolo dramas in pinedrama_dramas
    const contaminatedDramas = await PineDramaDrama.find({
      $or: [
        { provider: 'melolo' },
        { source: { $regex: 'Melolo', $options: 'i' } },
        { categories: 'Melolo Short Drama' },
      ],
    }).lean();

    if (contaminatedDramas.length > 0) {
      console.log(`[MongoDB Migration] Found ${contaminatedDramas.length} Melolo drama documents in pinedrama_dramas. Migrating...`);

      for (const d of contaminatedDramas) {
        const bookId = String(d.collection_id || d.dramaId);
        if (!bookId) continue;

        // Upsert to MeloloDrama
        await MeloloDrama.findOneAndUpdate(
          { book_id: bookId },
          {
            book_id: bookId,
            collection_id: bookId,
            dramaId: bookId,
            title: d.title,
            synopsis: d.synopsis || '',
            hasSynopsis: Boolean(d.synopsis && d.synopsis.trim().length > 0),
            coverUrl: d.coverUrl || '',
            categories: d.categories || [],
            totalEpisodes: d.totalEpisodes || 0,
            syncedEpisodesCount: d.syncedEpisodesCount || 0,
            pendingEpisodesCount: d.pendingEpisodesCount || 0,
            views: d.views || 0,
            syncStatus: d.syncStatus || 'PENDING_EPISODES',
            source: d.source || 'Melolo Migration',
            isNewlyAdded: d.isNewlyAdded ?? true,
            importedAt: d.importedAt || new Date(),
            lastSyncedAt: d.lastSyncedAt || new Date(),
          },
          { upsert: true }
        );
        migratedDramas++;

        // Find corresponding contaminated episodes in pinedrama_episodes
        const contaminatedEpisodes = await PineDramaEpisode.find({
          $or: [{ dramaId: bookId }, { collection_id: bookId }],
        }).lean();

        for (const ep of contaminatedEpisodes) {
          await MeloloEpisode.findOneAndUpdate(
            { book_id: bookId, episodeNumber: ep.episodeNumber },
            {
              book_id: bookId,
              collection_id: bookId,
              dramaId: bookId,
              episodeNumber: ep.episodeNumber,
              video_id: ep.video_id || null,
              title: ep.title || `Episode ${ep.episodeNumber}`,
              streamUrl: ep.streamUrl || ep.bestUrl || null,
              backupUrls: ep.backupUrls || [],
              syncStatus: ep.syncStatus === 'SYNCED' ? 'SYNCED' : 'PENDING',
              lastSyncedAt: ep.lastSyncedAt,
            },
            { upsert: true }
          );
          migratedEpisodes++;
        }

        // Delete migrated episodes from pinedrama_episodes
        await PineDramaEpisode.deleteMany({
          $or: [{ dramaId: bookId }, { collection_id: bookId }],
        });
      }

      // Delete migrated dramas from pinedrama_dramas
      const dramaIdsToDelete = contaminatedDramas.map((d) => d._id);
      await PineDramaDrama.deleteMany({ _id: { $in: dramaIdsToDelete } });
      console.log(`[MongoDB Migration] Purged ${contaminatedDramas.length} Melolo drama documents from pinedrama_dramas.`);
    }

    // 2. Find contaminated Melolo categories in pinedrama_categories
    const contaminatedCategories = await PineDramaCategory.find({
      $or: [{ provider: 'melolo' }, { name: 'Melolo Short Drama' }],
    }).lean();

    if (contaminatedCategories.length > 0) {
      for (const cat of contaminatedCategories) {
        await MeloloCategory.findOneAndUpdate(
          { categoryId: cat.categoryId },
          {
            categoryId: cat.categoryId,
            name: cat.name,
            slug: cat.slug || cat.categoryId,
            totalTitles: cat.totalTitles || 0,
            lastSyncedAt: cat.lastSyncedAt || new Date(),
          },
          { upsert: true }
        );
        migratedCategories++;
      }

      await PineDramaCategory.deleteMany({
        _id: { $in: contaminatedCategories.map((c) => c._id) },
      });
      console.log(`[MongoDB Migration] Purged ${contaminatedCategories.length} Melolo category documents from pinedrama_categories.`);
    }

    if (migratedDramas > 0 || migratedCategories > 0) {
      console.log(
        `[MongoDB Migration] Cleanup complete! Migrated: ${migratedDramas} dramas, ${migratedEpisodes} episodes, ${migratedCategories} categories to melolo_* collections.`
      );
    }
  } catch (err) {
    console.error('[MongoDB Migration] Error during runMigrationAndCleanup:', err);
  }

  return { migratedDramas, migratedEpisodes, migratedCategories };
}
