import { model, Schema } from "mongoose";

const UptimeResultSchema = new Schema(
  {
    monitorId: { type: Schema.Types.ObjectId, ref: "UptimeMonitor", required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true }, // easy per-user queries
   result: {
            type: Schema.Types.Mixed,
            required: true,
        },
    checkedAt: { type: Date, default: Date.now },
  },
  { versionKey: false } // no timestamps: checkedAt is enough, saves space
);


UptimeResultSchema.index({ checkedAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });

UptimeResultSchema.index({ monitorId: 1, checkedAt: -1 });

export const UptimeResult = model("UptimeResult", UptimeResultSchema);
