import {CareError, instructions, outputSchema} from './care.mjs';

export function providerStatus(env=process.env) {
  const provider=env.SPROUT_PROVIDER, model=env.SPROUT_MODEL;
  const configured=Boolean(model && (provider==='ollama' || (provider==='openai'&&env.OPENAI_API_KEY) || (provider==='gemini'&&env.GEMINI_API_KEY)));
  return {configured,provider:provider||null,model:model||null};
}
async function request(url,options,fetchImpl) {
  let response;
  try { response=await fetchImpl(url,{...options,signal:AbortSignal.timeout(90000)}); }
  catch { throw new CareError(503,'The AI service could not be reached. Try again later.'); }
  if(response.status===503)throw new CareError(503,'The AI provider is temporarily busy. Please try the care review again shortly.');
  if(response.status===429)throw new CareError(429,'The AI request limit has been reached. Please wait before asking for another review.');
  if (!response.ok) throw new CareError(503,'The AI provider rejected this request. Check the care-service configuration and account limits.');
  try { return await response.json(); } catch { throw new CareError(502,'The AI service returned an unreadable response.'); }
}
export async function generate(context,{env=process.env,fetchImpl=fetch}={}) {
  const status=providerStatus(env);
  if (!status.configured) throw new CareError(503,'AI is not configured. Set the backend provider, model and provider credentials first.');
  const prompt=JSON.stringify(context);
  let content;
  if (status.provider==='openai') {
    const data=await request('https://api.openai.com/v1/responses',{
      method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+env.OPENAI_API_KEY},
      body:JSON.stringify({model:status.model,store:false,instructions,input:prompt,max_output_tokens:4000,
        text:{format:{type:'json_schema',name:'sprout_care',strict:true,schema:outputSchema}}}),
    },fetchImpl);
    if (data.status!=='completed') throw new CareError(502,'The AI response was not completed. No watering request was created.');
    content=(data.output??[]).flatMap(item=>item.content??[]).filter(item=>item.type==='output_text').map(item=>item.text).join('');
  } else if (status.provider==='gemini') {
    const model=encodeURIComponent(status.model);
    const data=await request('https://generativelanguage.googleapis.com/v1beta/models/'+model+':generateContent',{
      method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':env.GEMINI_API_KEY},
      body:JSON.stringify({systemInstruction:{parts:[{text:instructions}]},contents:[{role:'user',parts:[{text:prompt}]}],
        generationConfig:{responseMimeType:'application/json',responseJsonSchema:outputSchema}}),
    },fetchImpl);
    if (data.candidates?.[0]?.finishReason!=='STOP') throw new CareError(502,'The AI response was not completed. No watering request was created.');
    content=data.candidates[0].content.parts.map(p=>p.text??'').join('');
  } else {
    const base=new URL(env.OLLAMA_HOST||'http://127.0.0.1:11434');
    if (!['127.0.0.1','localhost','[::1]'].includes(base.hostname)) throw new CareError(503,'The local AI host must be a loopback address.');
    const data=await request(new URL('/api/chat',base),{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({model:status.model,stream:false,format:outputSchema,messages:[{role:'system',content:instructions},{role:'user',content:prompt}]}),
    },fetchImpl);
    if (data.done!==true) throw new CareError(502,'The local AI response was incomplete.');
    content=data.message?.content;
  }
  try { return JSON.parse(content); } catch { throw new CareError(502,'The AI response did not contain a care plan.'); }
}
