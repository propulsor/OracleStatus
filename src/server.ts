const socketioAuth = require("socketio-auth");
import {ZapRegistry} from "@zapjs/registry"
const Web3 = require("web3")
import {hexToUtf8} from "web3-utils"
const Hapi = require("@hapi/hapi")
const Boom = require("boom")
const INFURA = "wss://mainnet.infura.io/ws/v3/63dbbe242127449b9aeb061c6640ab95"
const web3 = new Web3(INFURA)
const Registry = new ZapRegistry({networkProvider:web3})
const STATUS = "online"
let ORACLES:any = {}
let CLIENTS:any = {}

async function getAllOracle(){
    let all_oracles = await Registry.getAllProviders()
    let oracles =all_oracles.toString().split(",")
    for(let oracle of oracles){
        const allEndpoints = await Registry.getProviderEndpoints(oracle)
        if(allEndpoints.length>0){
            ORACLES[oracle]={}
            for(let endpoint of allEndpoints){
                ORACLES[oracle][endpoint]=false
            }
        }
    }

}
const authenticate = async (socket:any, data:any, callback:Function) => {
  const {endpoint,signature} = data;
  try {
      const address = await verifyOracle(endpoint,signature)
      if(!address){
          return callback({message:"Not a valid oracle"})
      }
      CLIENTS[socket.id]=address+":"+endpoint
      if(!ORACLES[address]){
        ORACLES[address]={}
      }
      ORACLES[address][endpoint]=true
      callback(null, "Authenticated");
  } catch (error) {
      console.log("error authenticate : ", error)
    return callback({message:"UNAUTHORIZED : "+socket.id});
  }
};

const postAuthenticate = (socket:any) => {
    console.log("AUTHENTICATED : ",socket.id)
};
const disconnect  = async (socket:any)=>{
    console.log("Socket disconnected",socket.id)
    if(CLIENTS[socket.id]){
        const [address,endpoint] = CLIENTS[socket.id].split(":")
        console.log("clean up socket id")
        ORACLES[address][endpoint]=false
    }
}

const verifyOracle = async (endpoint:string,sig:string)=>{
  try{
    const oracleAddress = web3.eth.accounts.recover(endpoint, sig)
    const title = await Registry.getProviderTitle(oracleAddress)
    if(!title){
        throw "Invalid Oracle address"
    }
    const allEndpoints = await Registry.getProviderEndpoints(oracleAddress)
    if(!allEndpoints.includes(endpoint)){
        throw "Invalid Endpoint"
    }
    return oracleAddress
}catch(e){
  console.error("error verifying oracle address",e)
  return  null
}
}

async function startRestServer(){
    getAllOracle()
    const server = new Hapi.server({
        port:8000,
        host:"localhost"
    })
    server.route({
      method:"POST",
      path:"/status",
      config:{
        payload:{ output: "data", parse: true, allow: "application/json" },
        plugins: { websocket: true },
      },
        handler:(request:any,h:any)=>{
          let { mode } = request.websocket()
         return { at: "bar", mode: mode, seen: request.payload }
        }

    })
    server.route({
        method:"GET",
        path:"/oracles",
        handler:(request:any,h:any)=>{
            return JSON.stringify(ORACLES)
        }
    })
    server.route({
        method:"POST",
        path:"/update",
        handler:async (request:any,h:any)=>{
            try {
                const sig = request.payload.signature
                const data = request.payload.data

                if(!sig || !data){
                    throw Boom.badRequest("signature and endpoint are required")
                }
                const endpoint:string = data.split(":")[0]
                const time = data.split(":")[1]
                const timeDelta:number = (new Date().getTime())-time
                console.log(data,endpoint, time,timeDelta,timeDelta/(60*1000))
                if(timeDelta/(60*1000)>5){
                  throw Boom.badRequest("Update must be within last 5 minutes")
                }
                const oracleAddress = web3.eth.accounts.recover(data, sig)
                const title = await Registry.getProviderTitle(oracleAddress)
                if(!title){
                    throw Boom.badRequest("Invalid Oracle address")
                }
                const allEndpoints = await Registry.getProviderEndpoints(oracleAddress)
                if(!allEndpoints.includes(endpoint)){
                    throw Boom.badRequest("Invalid Endpoint")
                }
                ORACLES[oracleAddress][endpoint] = true
                console.log(oracleAddress,endpoint,ORACLES)
                return true
            }catch(e){
                const error = Boom.badRequest('Error update status'+e);
                error.output.statusCode = 303;    // Assign a custom error code
                error.reformat();
                throw error
            }
        }
    })
    await server.start()
    console.log("server running on 8000")
    const io = require("socket.io")(server.listener,{path:"/ws/"});
    socketioAuth(io, { authenticate, postAuthenticate ,disconnect});
    console.log("websocket running")


}

startRestServer()
