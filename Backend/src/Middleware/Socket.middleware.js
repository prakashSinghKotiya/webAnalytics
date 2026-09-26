
import * as cookie from "cookie"; 
import cookieParser from "cookie-parser"; // Needed to unsign the cookie
import Session from "../Models/Session.Model.js";




export const socketAuthMiddleware = async (socket , next ) => {
  try {
    
    const cookieHeader = socket.handshake.headers.cookie;

    if (!cookieHeader) {
      return next(new Error("Authentication required. No cookies found."));
    }

   
    const cookies = cookie.parseCookie(cookieHeader);
    let rawToken = cookies.token;

    if (!rawToken) {
      return next(new Error("Authentication token is missing"));
    }


    const token = cookieParser.signedCookie(rawToken, process.env.COOKIE_SECRET);


    if (!token || token === rawToken) {
       return next(new Error("Invalid cookie signature"));
    }

    const user = await Session.findById(token)
        if (!user) {
      return next(
        new Error("Session expired or invalid")
      );
    }



      socket.data.userId = user.userId.toString();

    next();
    
  } catch (error) {
    next(new Error("Invalid authentication token"));
  }
};