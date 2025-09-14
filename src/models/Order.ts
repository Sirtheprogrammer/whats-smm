import mongoose, { Schema, Document } from 'mongoose';

export interface IOrder extends Document {
  userId: mongoose.Types.ObjectId;
  smmOrderId: string;
  service: {
    id: string;
    name: string;
    type: string;
    platform: string;
  };
  link: string;
  quantity: number;
  amount: number;
  status: string;
  paymentStatus: string;
  paymentReference?: string;
  createdAt: Date;
  updatedAt: Date;
}

const OrderSchema: Schema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  smmOrderId: { type: String, unique: true },
  service: {
    id: { type: String, required: true },
    name: { type: String, required: true },
    type: { type: String, required: true },
    platform: { type: String, required: true }
  },
  link: { type: String, required: true },
  quantity: { type: Number, required: true },
  amount: { type: Number, required: true },
  status: { type: String, default: 'pending' },
  paymentStatus: { type: String, default: 'pending' },
  paymentReference: { type: String },
}, { timestamps: true });

export default mongoose.model<IOrder>('Order', OrderSchema);
