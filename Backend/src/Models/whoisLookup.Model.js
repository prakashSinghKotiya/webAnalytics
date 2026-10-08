import { model, Schema } from "mongoose";

const whoisLookupSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: false,
      index: true,
    },

    guestId: {
      type: String,
      index: true,
    },

    roomId: {
      type: String,
      required: true,
      index: true,
    },

    url: {
      type: String,
      required: true,
      trim: true,
    },

    status: {
      type: String,
      enum: ["queued", "processing", "completed", "failed"],
      default: "queued",
      index: true,
    },

    result: {
      type: Schema.Types.Mixed,
      default: null,
    },

    error: {
      type: String,
      default: null,
    },

    completedAt: {
      type: Date,
      default: null,
    },

    createdAt: {
      // TTL index (1 day)
      type: Date,
      default: Date.now,
      expires: 60 * 60 * 24 * 1,
    },
  },
  {
    timestamps: true,
  }
);

whoisLookupSchema.index({
  userId: 1,
  createdAt: -1,
});

whoisLookupSchema.index({
  guestId: 1,
  createdAt: -1,
});

export const WhoisLookup = model("WhoisLookup", whoisLookupSchema);