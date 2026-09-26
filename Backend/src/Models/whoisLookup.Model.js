import { model, Schema } from "mongoose";

const whoisLookupSchema = new Schema(
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


  
    completedAt: {
      type: Date,
      default: null,
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

export const WhoisLookup = model("WhoisLookup", whoisLookupSchema);