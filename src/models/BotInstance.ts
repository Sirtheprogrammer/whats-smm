import mongoose, { Schema, Document } from 'mongoose';

export interface IBotInstance extends Document {
  name: string;
  phoneNumber: string;
  status: 'active' | 'inactive' | 'connecting';
  authPath: string;
  enabledServices: {
    serviceId: string;
    platform: string;
    category: string;
    enabled: boolean;
  }[];
  createdAt: Date;
  updatedAt: Date;
}

const BotInstanceSchema: Schema = new Schema({
  name: { type: String, required: true },
  phoneNumber: { type: String, required: true, unique: true },
  status: { 
    type: String, 
    enum: ['active', 'inactive', 'connecting'], 
    default: 'inactive' 
  },
  authPath: { type: String, unique: true },
  enabledServices: [{
    serviceId: { type: String, required: true },
    platform: { type: String, required: true },
    category: { type: String, required: true },
    enabled: { type: Boolean, default: true }
  }],
}, { timestamps: true });

export default mongoose.model<IBotInstance>('BotInstance', BotInstanceSchema);
