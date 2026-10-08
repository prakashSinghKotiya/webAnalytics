import { model, Schema } from "mongoose";

const ttfbSchema = new Schema(
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

  
    region: {
      type: String,
      enum: ["india", "europe", "usa"],
      required: true,
      
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

    // Error if the worker fails
    error: {
      type: String,
      default: null,
    },

  
    completedAt: {
      type: Date,
      default: null,
    },

    createdAt: { // ttl index 
    type: Date,
    default: Date.now,
    expires:  60 * 60 * 24 * 1, 
  },
  },
  {
    timestamps: true,
  }
);


ttfbSchema.index({
  userId: 1,
  createdAt: -1,
});
ttfbSchema.index({ guestId: 1, createdAt: -1 });

export const Ttfb = model("Ttfb", ttfbSchema);
