import { model, Schema } from "mongoose";
import { required } from "zod/mini";

const userSchema = new Schema({ 
     name: {
      type: String,
      required: true,
      minLength: [
        3,
        "name field should a string with at least three characters",
      ],
    },
    email: {
      type: String,
      required: true,
      unique: true, //this is how we are creatin unique index 
      match: [
        /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+.[a-zA-Z]{2,}$/,
        "please enter a valid email",
      ],
    },
    password: {
      type: String,
    
      minLength: 4,
    },
    picture: {
      type: String,
      default:
        "https://static.vecteezy.com/system/resources/previews/002/318/271/non_2x/user-profile-icon-free-vector.jpg",
    },
  
    role: {
      type : String,
      enum : [ "User" , "Admin" ],
      default : "User"
    },

     plans: {
          type: String,
           enum : [ "free" , "pro" ],
          default: "free",
          
        },
    deleted :{
      type :Boolean,
      default :false
    },
       },
    {
    strict: "throw",
     })

const User = model("User", userSchema) 

export default User 