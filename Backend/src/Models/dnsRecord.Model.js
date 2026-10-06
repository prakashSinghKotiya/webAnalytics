import { model, Schema } from "mongoose";

const DnsRecordSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
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

DnsRecordSchema.index({
  userId: 1,
  createdAt: -1,
});

export const DnsRecord = model("DnsRecord", DnsRecordSchema);