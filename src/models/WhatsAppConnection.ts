import mongoose from 'mongoose';
import { Schema, Document } from 'mongoose';

export interface IWhatsAppConnection extends Document {
  phoneNumber: string;
  name: string;
  status: 'pending' | 'connected' | 'disconnected';
  pairingCode?: string;
  lastConnection?: Date;
  authPath: string;
  createdAt: Date;
  updatedAt: Date;
}

const WhatsAppConnectionSchema: Schema = new Schema({
  phoneNumber: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  status: { 
    type: String, 
    enum: ['pending', 'connected', 'disconnected'],
    default: 'pending'
  },
  pairingCode: { type: String },
  lastConnection: { type: Date },
  authPath: { type: String, required: true, unique: true },
}, { timestamps: true });

export default mongoose.model<IWhatsAppConnection>('WhatsAppConnection', WhatsAppConnectionSchema);
