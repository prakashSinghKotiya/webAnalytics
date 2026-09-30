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


DnsRecordSchema.index({
  userId: 1,
  createdAt: -1,
});

export const DnsRecord = model("DnsRecord", DnsRecordSchema);