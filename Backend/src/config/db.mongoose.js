import mongoose from "mongoose";

export async function connectdb(){
    try {
       await mongoose.connect(process.env.DB_URL || "mongodb://localhost:27017/webAnaysis")
       console.log("Database connectedd");
       
      
    } catch (err) {
       console.log(err);
    console.log("Could Not Connect to the Database");
    process.exit(1);
    }
}

process.on("SIGINT", async () => { // gracefully disconnect
  await mongoose.disconnect();
  console.log("Client Disconnected!");
  process.exit(0);
});