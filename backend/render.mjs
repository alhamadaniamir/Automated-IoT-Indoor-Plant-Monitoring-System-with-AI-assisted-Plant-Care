import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {parseEnv} from 'node:util';
import {readRenderToken} from './render-auth.mjs';
import {RenderClient,renderService,plantRepository,cloudBranch,serviceName} from './render-client.mjs';

const directory=join(homedir(),'.config','sprout');
const command=process.argv[2]||'status';
try {
  const credentials=parseEnv(await readFile(join(directory,'backend.env'),'utf8'));
  const token=await readRenderToken(directory);
  const client=new RenderClient(token,{secrets:[credentials.GEMINI_API_KEY,credentials.SPROUT_APP_TOKEN]});
  if(command==='owners'){
    const owners=await client.request('/owners?limit=100');
    console.log(JSON.stringify(owners.map(row=>({id:row.owner.id,name:row.owner.name,type:row.owner.type})),null,2));
  }else if(command==='deploy'){
    const owners=await client.request('/owners?limit=100');
    const selected=process.argv.find(arg=>arg.startsWith('--owner='))?.slice(8);
    const owner=selected?owners.find(row=>row.owner.id===selected)?.owner:owners.length===1?owners[0].owner:null;
    if(!owner)throw new Error('Choose your workspace: run node backend/render.mjs owners, then deploy --owner=WORKSPACE_ID.');
    const rows=await client.request('/services?ownerId='+encodeURIComponent(owner.id)+'&name='+encodeURIComponent(serviceName)+'&limit=100');
    let service=rows.map(row=>row.service).find(item=>item.name===serviceName),deployId;
    if(service){
      if(service.repo?.replace(/\.git$/,'')!==plantRepository||service.branch!==cloudBranch||service.rootDir!=='backend'||service.serviceDetails?.plan!=='free')throw new Error('An existing service with this name has different settings. Review it before deploying.');
      console.log('Found the existing free Sprout service; no duplicate service was created.');
    }else{
      const created=await client.request('/services',{method:'POST',body:renderService(owner.id,credentials)});
      service=created.service;deployId=created.deployId;
    }
    const url=service.serviceDetails?.url;
    if(typeof url!=='string'||!url.startsWith('https://')||!new URL(url).hostname.endsWith('.onrender.com'))throw new Error('Render did not return the expected HTTPS address. Check its dashboard.');
    const state={id:service.id,url,owner_id:owner.id,repo:plantRepository,branch:cloudBranch,plan:'free',deploy_id:deployId??null};
    await mkdir(directory,{recursive:true,mode:0o700});
    await writeFile(join(directory,'render-service.json'),JSON.stringify(state,null,2)+'\n',{mode:0o600});
    console.log(JSON.stringify({service_id:service.id,url,plan:'free',deploy_id:deployId??null,dashboard:service.dashboardUrl}));
  }else if(command==='status'){
    const state=JSON.parse(await readFile(join(directory,'render-service.json'),'utf8'));
    if(!/^srv-[a-z0-9]+$/.test(state.id))throw new Error('Invalid saved service ID.');
    const service=await client.request('/services/'+state.id);
    const deploys=await client.request('/services/'+state.id+'/deploys?limit=3');
    console.log(JSON.stringify({service_id:service.id,url:service.serviceDetails?.url,plan:service.serviceDetails?.plan,
      deployments:deploys.map(row=>({id:row.deploy.id,status:row.deploy.status,commit:row.deploy.commit?.id}))},null,2));
  }else throw new Error('Use: render.mjs owners | deploy [--owner=ID] | status');
} catch(error){
  console.error(error.code==='ENOENT'?'Run node backend/render-login.mjs first; deploy before checking status.':error.message);
  process.exitCode=1;
}
