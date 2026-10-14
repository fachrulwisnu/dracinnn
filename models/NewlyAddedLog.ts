import mongoose, { Schema, Document } from 'mongoose';

export interface INewlyAddedDrama {
  dramaId: string;
  title: string;
  coverUrl?: string;
  totalEpisodes: number;
  categories?: string[];
}

export interface INewlyAddedLog extends Document {
  source: string; // e.g. 'Trending (Page 1-3)', 'Category: Romansa'
  totalImported: number;
  totalNewEpisodes: number;
  dramas: INewlyAddedDrama[];
  importedAt: Date;
}

const NewlyAddedLogSchema = new Schema<INewlyAddedLog>(
  {
    source: { type: String, required: true },
    totalImported: { type: Number, required: true },
    totalNewEpisodes: { type: Number, required: true },
    dramas: [
      {
        dramaId: { type: String, required: true },
        title: { type: String, required: true },
        coverUrl: { type: String, default: '' },
        totalEpisodes: { type: Number, required: true },
        categories: { type: [String], default: [] },
      },
    ],
    importedAt: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
    collection: 'pinedrama_newly_added',
  }
);

export const NewlyAddedLog =
  mongoose.models.NewlyAddedLog ||
  mongoose.model<INewlyAddedLog>('NewlyAddedLog', NewlyAddedLogSchema);
