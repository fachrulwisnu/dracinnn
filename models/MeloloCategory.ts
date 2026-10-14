import mongoose, { Schema, Document } from 'mongoose';

export interface IMeloloCategory extends Document {
  categoryId: string;
  name: string;
  slug: string;
  totalTitles: number;
  lastSyncedAt?: Date;
}

const MeloloCategorySchema = new Schema<IMeloloCategory>(
  {
    categoryId: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    slug: { type: String, default: '' },
    totalTitles: { type: Number, default: 0 },
    lastSyncedAt: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
    collection: 'melolo_categories',
  }
);

export const MeloloCategory =
  mongoose.models.MeloloCategory ||
  mongoose.model<IMeloloCategory>('MeloloCategory', MeloloCategorySchema);
