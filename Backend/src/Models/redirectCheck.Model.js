import { model, Schema } from "mongoose";

const redirectSchema = new Schema(
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


    result: {
      type: Schema.Types.Mixed,
      default: null,
    },

         createdAt: { // ttl index 
    type: Date,
    default: Date.now,
    expires:  60 * 60 * 24 * 1, // 1 days
  },


  
    completedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);


redirectSchema.index({
  userId: 1,
  createdAt: -1,
});

export const RedirectCheck = model("RedirectCheck", redirectSchema);