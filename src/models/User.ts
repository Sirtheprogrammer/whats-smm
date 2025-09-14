import mongoose, { Schema, Document } from 'mongoose';

export interface IUser extends Document {
  phoneNumber: string;
  name?: string;
  whatsappId: string;
  botId: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema: Schema = new Schema({
  phoneNumber: { type: String, required: true, unique: true },
  name: { type: String },
  whatsappId: { type: String, required: true, unique: true },
  botId: { type: Schema.Types.ObjectId, ref: 'BotInstance', required: true }
}, { timestamps: true });

export default mongoose.model<IUser>('User', UserSchema);
