const connection = {
  host: process.env.REDIS_HOST  ,
  port: Number(process.env.REDIS_PORT ),
  username: process.env.REDIS_USERNAME,
  password: process.env.REDIS_PASSWORD,
};


console.log("redis",  connection)

export default connection;