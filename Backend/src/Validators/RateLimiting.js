import { rateLimit } from 'express-rate-limit'
import { slowDown } from 'express-slow-down'



export const generalLimiter = rateLimit({   
	
	windowMs:  15 * 60 * 1000,
	limit: 100,             
	standardHeaders: 'draft-8', 
	legacyHeaders: false, 
	ipv6Subnet: 56, 
  
})


export const registerLimiter = rateLimit({    
	windowMs:  60 * 1000, 
	limit: 3,             
	standardHeaders: 'draft-8', 
	legacyHeaders: false, 
	ipv6Subnet: 56, 
	
})

/// throttling 

export const requstThrottling =  slowDown({
	windowMs: 60 * 1000,
	delayAfter: 5, 
	delayMs: (hits) => (hits - 5) * 1000, 
	skip: () => process.env.NODE_ENV === 'test',
})

export const contactLimiter = rateLimit({
	windowMs: 15 * 60 * 1000,
	limit: 5,
	standardHeaders: 'draft-8',
	legacyHeaders: false,
	ipv6Subnet: 56,
	skip: () => process.env.NODE_ENV === 'test',
	message: {
		success: false,
		message: 'Too many contact requests from this IP, please try again after 15 minutes.',
	},
})