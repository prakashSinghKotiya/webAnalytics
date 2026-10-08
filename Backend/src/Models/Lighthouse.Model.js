import { model, Schema } from "mongoose";

const LighthouseSchema = new Schema(
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

    strategy: {
      type: String,
      enum: ["mobile", "desktop", "both"],
      default: "mobile",
    },

    status: {
      type: String,
      enum: ["queued", "processing", "completed", "failed"],
      default: "queued",
      index: true,
    },

    data: {
      type: String,
      trim: true,
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
      // ttl index (1 day)
      type: Date,
      default: Date.now,
      expires: 60 * 60 * 24 * 1,
    },
  },
  {
    timestamps: true,
  }
);

LighthouseSchema.index({
  userId: 1,
  createdAt: -1,
});
LighthouseSchema.index({ guestId: 1, createdAt: -1 });

export const Lighthouse = model("Lighthouse", LighthouseSchema);
