import mongoose, { Schema } from 'mongoose';

const MessageSchema = new Schema(
  {
    conversationId: {
      type: Schema.Types.ObjectId,
      ref: 'Conversation',
      required: true,
      index: true,
    },

    senderId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    // Normal text message
    text: {
      type: String,
      default: '',
      trim: true,
      maxlength: 4000,
    },

    // Message type: text, image, or file
    messageType: {
      type: String,
      enum: ['text', 'image', 'file'],
      default: 'text',
    },

    // Uploaded image or file information
    attachment: {
      url: {
        type: String,
        default: '',
      },
      fileName: {
        type: String,
        default: '',
      },
      mimeType: {
        type: String,
        default: '',
      },
      size: {
        type: Number,
        default: 0,
      },
    },

    // Reply to another message
    replyTo: {
      type: Schema.Types.ObjectId,
      ref: 'Message',
      default: null,
    },

    // Emoji reactions
    reactions: [
      {
        userId: {
          type: Schema.Types.ObjectId,
          ref: 'User',
          required: true,
        },
        emoji: {
          type: String,
          required: true,
        },
      },
    ],

    readBy: [
      {
        type: Schema.Types.ObjectId,
        ref: 'User',
      },
    ],

    deletedFor: [
      {
        type: Schema.Types.ObjectId,
        ref: 'User',
      },
    ],

    isDeletedForEveryone: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

MessageSchema.index({ conversationId: 1, createdAt: -1 });

export default mongoose.model('Message', MessageSchema);