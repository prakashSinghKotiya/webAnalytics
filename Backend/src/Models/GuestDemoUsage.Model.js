import { model, Schema } from "mongoose";

// Centralized daily guest usage model.
// Unique index on (guestId, day) enforces a strict single daily counter per guest.
const guestDemoUsageSchema = new Schema(
  {
    guestId: {
      type: String,
      required: true,
      index: true,
    },
    day: {
      type: String,
      required: true, // UTC calendar day: YYYY-MM-DD
    },
    count: {
      type: Number,
      default: 0,
      min: 0,
    },
    history: [
      {
        service: {
          type: String,
          enum: ["ttfb", "lighthouse", "whois", "dns", "redirect"],
          required: true,
        },
        url: {
          type: String,
          trim: true,
        },
        usedAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    expiresAt: {
      type: Date,
      required: true,
      index: { expires: 0 },
    },
  },
  { timestamps: true }
);

guestDemoUsageSchema.index({ guestId: 1, day: 1 }, { unique: true });

export const GuestDemoUsage = model("GuestDemoUsage", guestDemoUsageSchema);
