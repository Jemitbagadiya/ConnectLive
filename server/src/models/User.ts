import mongoose, { Schema } from 'mongoose';

const UserSchema = new Schema({
  name: { type: String, required: true, trim: true, maxlength: 60 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
  passwordHash: { type: String, required: true, select: false },
  connections: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  lastSeen: { type: Date, default: Date.now },
}, { timestamps: true });

export default mongoose.model('User', UserSchema);
