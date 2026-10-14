import mongoose, { Schema, Document } from 'mongoose';

export interface ICategory extends Document {
  provider: 'pinedrama';
  categoryId: string;
  name: string;
  slug: string;
  totalTitles: number;
  syncStatus: 'IDLE' | 'SYNCING' | 'COMPLETED' | 'FAILED';
  lastSyncedAt?: Date;
}

const CategorySchema = new Schema<ICategory>(
  {
    provider: { type: String, default: 'pinedrama', index: true },
    categoryId: { type: String, required: true, index: true, unique: true },
    name: { type: String, required: true },
    slug: { type: String, default: '' },
    totalTitles: { type: Number, default: 0 },
    syncStatus: {
      type: String,
      enum: ['IDLE', 'SYNCING', 'COMPLETED', 'FAILED'],
      default: 'IDLE',
    },
    lastSyncedAt: { type: Date },
  },
  {
    timestamps: true,
    collection: 'pinedrama_categories',
  }
);

export const Category = mongoose.models.Category || mongoose.model<ICategory>('Category', CategorySchema);
export const PineDramaCategory = Category;
