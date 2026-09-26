import { model, Schema } from "mongoose";

const LighthouseSchema = new Schema(
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
            trim: true
        },
        
        data:{
            type: String,
            trim: true
        },
        result: {
              type: Schema.Types.Mixed,
              default: null,
            },

    },
    {
        timestamps: true
    }
);

export const Lighthouse = model( "Lighthouse", LighthouseSchema );