import {OAuth2Client} from 'google-auth-library'

 const clientId = process.env.GOOGLE_CLIENT_ID

const client = new OAuth2Client(clientId )

export  async function verifyIdToken(token){
    try {
   const response =  await client.verifyIdToken({ 
        idToken: token,
        audience : clientId 
    })

    console.log(response);
    

    const userDetails = response.getPayload()
  
    return userDetails
    
    
}catch (error) {
    console.log(error)
    throw error;
    
} 

    
}