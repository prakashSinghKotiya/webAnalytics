import { rateLimit } from 'express-rate-limit'
import { slowDown } from 'express-slow-down'



export const generalLimiter = rateLimit({   
	
	windowMs:  15 * 60 * 1000, // 15 minutes
	limit: 100,             // allowing only 100 req/ 15 min
	standardHeaders: 'draft-8', 
	legacyHeaders: false, 
	ipv6Subnet: 56, 
  
})


export const registerLimiter = rateLimit({    
	windowMs:  60 * 1000, // 1 minutes
	limit: 3,             // allowing only 5 req/min
	standardHeaders: 'draft-8', 
	legacyHeaders: false, 
	ipv6Subnet: 56, 
	
})

/// throttling 

export const requstThrottling =  slowDown({
	windowMs: 60 * 1000, // cleaning the req array of that ip addedd after 1 min 
	delayAfter: 5, // after 5 consequtive req it will start delaying thr req
	delayMs: (hits) => (hits - 5) * 1000, // Addding 1 sec of delay after ever 5 req in a min after a min it will be clean and again if there are more than 5 req it will delay 
})