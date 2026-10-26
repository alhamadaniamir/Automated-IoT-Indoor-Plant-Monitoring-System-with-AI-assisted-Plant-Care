import {createServer} from 'node:http';
import {timingSafeEqual} from 'node:crypto';
import {existsSync,readFileSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {CareError, validateInput, modelContext, validatePlan, fingerprint} from './care.mjs';
import {generate,providerStatus} from './providers.mjs';
import {weather,locations} from './weather.mjs';
import {cloudRuntime,serverAddress} from './runtime.mjs';

export function createCareServer({env=process.env,generateImpl=generate,weatherImpl=weather,locationsImpl=locations,now=Date.now}={}) {
  const cache=new Map(),pending=new Map(),reviews=new Map();
  function authorized(req) {
    const token=env.SPROUT_APP_TOKEN;
    if (!token || token.length<24) throw new CareError(503,'The care server needs its private app access token configured.');
    const given=Buffer.from(req.headers.authorization??'');
    const expected=Buffer.from('Bearer '+token);
    if (given.length!==expected.length || !timingSafeEqual(given,expected)) throw new CareError(401,'The care service access token is incorrect.');
  }
  function send(res,status,value) {
    res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
    res.end(JSON.stringify(value));
  }
  async function body(req) {
    if (!(req.headers['content-type']??'').startsWith('application/json')) throw new CareError(415,'Send JSON data.');
    let text=''; let bytes=0;
    for await (const chunk of req) {
      bytes+=chunk.length;
      if (bytes>98304) throw new CareError(413,'Care request is too large.');
      text+=chunk;
    }
    try { return JSON.parse(text); } catch { throw new CareError(400,'Invalid care request JSON.'); }
  }
  const server=createServer(async(req,res)=>{
    try {
      if (env===process.env&&!cloudRuntime(env)) reloadPrivateConfig();
      if (req.headers.origin) throw new CareError(403,'Use the paired Sprout mobile app.');
      const url=new URL(req.url,'http://localhost');
      if (req.method==='GET' && url.pathname==='/health') {
        send(res,200,{service:'sprout-care',schema_version:1,deployment:cloudRuntime(env)?'cloud':'local',...providerStatus(env)});return;
      }
      authorized(req);
      if (req.method==='GET' && url.pathname==='/api/locations') {
        send(res,200,{locations:await locationsImpl(url.searchParams.get('q'))});return;
      }
      if (req.method!=='POST' || url.pathname!=='/api/care/evaluate') throw new CareError(404,'Unknown care endpoint.');
      if (generateImpl===generate && !providerStatus(env).configured) throw new CareError(503,'Live AI is not configured. Add the model provider key to the care service; no AI recommendation has been generated.');
      const input=validateInput(await body(req));
      const key=fingerprint({provider:env.SPROUT_PROVIDER,model:env.SPROUT_MODEL,device:input.device_id,revision:input.context_revision,location:input.location,plants:input.plants.map(p=>({
        id:p.id,species:p.species,profile:p.profile,history:p.history.slice(-8),
        reading:p.reading?{bucket:Math.floor((p.reading.percent??-10)/10),faults:p.reading.faults,
          eligible:p.reading.age_ms<=120000,calibrated:p.reading.calibrated,boot:p.reading.boot_id}:null,
      }))});
      let cached=cache.get(key);
      if (cached && now()-cached.time<30*60*1000) {send(res,200,cached.value);return;}
      if (pending.has(key)) {send(res,200,await pending.get(key));return;}
      const last=reviews.get(input.device_id);
      if (last && now()-last<60000) throw new CareError(429,'Please wait a minute before asking the AI for another review.');
      reviews.set(input.device_id,now());
      const review=(async()=>{
        const outside=await weatherImpl(input.location);
        const raw=await generateImpl(modelContext(input,outside),{env});
        const value=validatePlan(raw,input,outside,{now:now(),provider:env.SPROUT_PROVIDER,model:env.SPROUT_MODEL});
        cache.set(key,{time:now(),value});
        if (cache.size>128) cache.delete(cache.keys().next().value);
        if (reviews.size>128) reviews.delete(reviews.keys().next().value);
        return value;
      })();
      pending.set(key,review);
      try {send(res,200,await review);} finally {pending.delete(key);}
    } catch(error) {
      send(res,error instanceof CareError?error.status:500,{error:error instanceof CareError?error.message:'The care review could not be completed. No watering action was issued.'});
    }
  });
  server.requestTimeout=100000;
  server.headersTimeout=15000;
  return server;
}

function reloadPrivateConfig() {
  const path=join(homedir(),'.config','sprout','backend.env');
  if (existsSync(path)) Object.assign(process.env,parseEnv(readFileSync(path,'utf8')));
}

if (process.argv[1] && fileURLToPath(import.meta.url)===fileURLToPath(new URL('file://'+process.argv[1]))) {
  if(!cloudRuntime())reloadPrivateConfig();
  const {host,port}=serverAddress();
  createCareServer().listen(port,host,()=>console.log('Sprout care service listening on '+host+':'+port+'; AI '+(providerStatus().configured?'configured':'not configured')));
}
