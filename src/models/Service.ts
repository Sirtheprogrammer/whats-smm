import mongoose from 'mongoose';
import { Schema, Document } from 'mongoose';

export interface IService extends Document {
  serviceId: string;
  platform: string;
  category: string;
  name: string;
  price: number;
  isEnabled: boolean;
  minOrder: number;
  maxOrder: number;
  description?: string;
  createdAt: Date;
  updatedAt: Date;
}

const ServiceSchema: Schema = new Schema({
  serviceId: { type: String, required: true, unique: true },
  platform: { type: String, required: true },
  category: { type: String, required: true },
  name: { type: String, required: true },
  price: { type: Number, required: true },
  isEnabled: { type: Boolean, default: true },
  minOrder: { type: Number, required: true },
  maxOrder: { type: Number, required: true },
  description: { type: String },
}, { timestamps: true });

export default mongoose.model<IService>('Service', ServiceSchema);
