export const plantRepository='https://github.com/alhamadaniamir/Automated-IoT-Indoor-Plant-Monitoring-System-with-AI-assisted-Plant-Care';
export const cloudBranch='sprout-cloud-ai';
export const serviceName='sprout-care-alhamadaniamir';

export function renderService(ownerId,credentials) {
  if(!/^(usr|tea)-[a-z0-9]+$/.test(ownerId))throw new Error('Choose a valid Render workspace.');
  if(!credentials.GEMINI_API_KEY||!credentials.SPROUT_APP_TOKEN||credentials.SPROUT_APP_TOKEN.length<24)throw new Error('Configure Gemini and the private app token first.');
  return {
    type:'web_service',name:serviceName,ownerId,repo:plantRepository,
    branch:cloudBranch,rootDir:'backend',autoDeployTrigger:'off',
    envVars:Object.entries({NODE_VERSION:'24',SPROUT_DEPLOYMENT:'cloud',SPROUT_PROVIDER:'gemini',
      SPROUT_MODEL:credentials.SPROUT_MODEL||'gemini-3.5-flash-lite',
      GEMINI_API_KEY:credentials.GEMINI_API_KEY,SPROUT_APP_TOKEN:credentials.SPROUT_APP_TOKEN,
    }).map(([key,value])=>({key,value})),
    serviceDetails:{runtime:'node',plan:'free',region:'singapore',numInstances:1,healthCheckPath:'/health',
      envSpecificDetails:{buildCommand:'node --test test/*.test.mjs',startCommand:'node server.mjs'}},
  };
}

export class RenderClient {
  constructor(token,{fetchImpl=fetch,secrets=[]}={}){this.token=token;this.fetchImpl=fetchImpl;this.secrets=[token,...secrets].filter(Boolean);}
  async request(path,{method='GET',body}={}) {
    if(!path.startsWith('/')||path.startsWith('//'))throw new Error('Invalid Render API path.');
    const response=await this.fetchImpl('https://api.render.com/v1'+path,{method,redirect:'error',
      headers:{Accept:'application/json',Authorization:'Bearer '+this.token,...(body?{'Content-Type':'application/json'}:{})},
      ...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(45000)});
    const data=response.status===204?null:await response.json();
    if(!response.ok){
      let message=typeof data?.message==='string'?data.message:'Check Render account access, repository access, and free-plan eligibility.';
      for(const secret of this.secrets)message=message.split(secret).join('[redacted]');
      throw new Error('Render request failed (HTTP '+response.status+'): '+message.slice(0,600));
    }
    return data;
  }
}
