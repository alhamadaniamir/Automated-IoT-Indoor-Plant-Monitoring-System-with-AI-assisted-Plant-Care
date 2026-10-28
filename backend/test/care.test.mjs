import test from 'node:test';
import assert from 'node:assert/strict';
import {validateInput,wateringEligible,validatePlan,modelContext} from '../care.mjs';
import {generate} from '../providers.mjs';
import {weather} from '../weather.mjs';
import {createCareServer} from '../server.mjs';

export function fixture() {
  return {device_id:'plantcare-test',context_revision:1,location:{name:'Cagayan de Oro, Philippines',latitude:8.48222,longitude:124.64722},
    plants:['chinese_bamboo','pandakaki','calathea'].map((species,i)=>({id:i+1,species,
      profile:{taxon:['lucky_bamboo','pandacaqui','calathea_group'][i],placement:'Indoors beside a window',light_exposure:'Filtered morning light',soil_mix:'Draining potting mix',pot_size_cm:'15',fertilizer:'User-recorded product label',last_fertilized_at:'2026-09-01T00:00:00Z',max_water_seconds:15},
      reading:{raw:3000,percent:20,calibrated:true,faults:[],age_ms:10,boot_id:'boot-test'},history:[],
    }))};
}
export function modelOutput() {
  const task={decision:'notify',summary:'Example test recommendation',reason:'Test-only provider output.',confidence:'medium'};
  return {plants:[1,2,3].map(plant_id=>({plant_id,water:{...task,decision:'water',seconds:15},fertilizer:{...task},light:{...task},missing_information:[]}))};
}
const outside={status:'available',source:'test-weather',observed_at:new Date().toISOString()};

test('all three species can receive combined care tasks; watering stays a proposal',()=>{
  const input=validateInput(fixture());
  const plan=validatePlan(modelOutput(),input,outside,{provider:'test',model:'test-model'});
  assert.equal(plan.source,'ai');assert.equal(plan.plants.length,3);
  assert.equal(plan.context_revision,1);
  assert.equal(plan.plants[0].water.seconds,15);
  assert.equal(plan.plants[0].fertilizer.decision,'notify');assert.equal(plan.plants[0].light.decision,'notify');
  assert.ok(plan.plants[0].sources[0].startsWith('https://plants.ces.ncsu.edu/'));
  assert.equal(plan.plants[0].reading_at_review.boot_id,'boot-test');
  assert.equal('command' in plan,false);
});
test('model cannot override faulty, stale, missing or uncalibrated soil data',()=>{
  for(const change of [p=>p.reading.faults=['adc_saturated'],p=>p.reading.age_ms=120001,p=>p.reading=null,p=>p.reading.calibrated=false,p=>p.reading.raw=4095]){
    const input=fixture();change(input.plants[0]);
    assert.equal(wateringEligible(input.plants[0]),false);
    const plan=validatePlan(modelOutput(),input,outside);
    assert.equal(plan.plants[0].water.decision,'check');assert.equal(plan.plants[0].water.seconds,null);
    assert.equal(plan.plants[1].water.decision,'water');
  }
});
test('unconfirmed identity, missing feed history and missing light observations remain checks',()=>{
  const input=fixture();input.plants[0].profile.taxon='';input.plants[1].profile.last_fertilized_at='';input.plants[2].profile.light_exposure='';
  const plan=validatePlan(modelOutput(),input,outside);
  assert.equal(plan.plants[0].water.decision,'check');assert.equal(plan.plants[0].light.decision,'check');
  assert.equal(plan.plants[1].fertilizer.decision,'check');assert.equal(plan.plants[2].light.decision,'check');
});
test('duplicate IDs, unbounded duration, malformed output and wrong identity are rejected',()=>{
  const input=fixture();input.plants[0].profile.taxon='divaricata';assert.throws(()=>validateInput(input));
  for(const change of [r=>r.plants[0].water.seconds=21,r=>r.plants[1].plant_id=1,r=>r.plants[0].light.decision='switch_relay']){
    const output=modelOutput();change(output);assert.throws(()=>validatePlan(output,fixture(),outside));
  }
});
test('one or two selected pots use their chosen species rather than the channel number',()=>{
  for (const ids of [[3],[1,3]]) {
    const input=fixture();
    input.plants=input.plants.filter(p=>ids.includes(p.id)).map(p=>({...p,species:'calathea',profile:{...p.profile,taxon:'calathea_group'}}));
    validateInput(input);
    const context=modelContext(input,outside);
    assert.deepEqual(context.plants.map(p=>p.id),ids);
    assert.ok(context.plants.every(p=>p.identity.name==='Calathea / Goeppertia group'));
    const output=modelOutput();output.plants=output.plants.filter(p=>ids.includes(p.plant_id));
    const result=validatePlan(output,input,outside);
    assert.deepEqual(result.plants.map(p=>p.plant_id),ids);
    assert.ok(result.plants.every(p=>p.sources[0]==='https://www.rhs.org.uk/plants/calathea/growing-guide'));
  }
});
test('empty requests, unselected model output and missing selected pots are rejected',()=>{
  const input=fixture();input.plants=[input.plants[2]];
  assert.throws(()=>validateInput({...input,plants:[]}));
  assert.throws(()=>validatePlan(modelOutput(),input,outside));
  const wrong=modelOutput();wrong.plants=[wrong.plants[0]];
  assert.throws(()=>validatePlan(wrong,input,outside));
});
test('missing model credentials never produce rules labeled as AI',async()=>{
  let called=false;
  await assert.rejects(generate({}, {env:{SPROUT_PROVIDER:'gemini',SPROUT_MODEL:'test'},fetchImpl:async()=>{called=true;}}),/not configured/);
  assert.equal(called,false);
});
test('Gemini adapter sends a schema and accepts only complete model responses',async()=>{
  let payload,headers;
  const env={SPROUT_PROVIDER:'gemini',SPROUT_MODEL:'test-model',GEMINI_API_KEY:'test-not-a-real-key'};
  const fetchImpl=async(url,options)=>{
    payload=JSON.parse(options.body);headers=options.headers;
    assert.ok(String(url).startsWith('https://generativelanguage.googleapis.com/'));
    return new Response(JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(modelOutput())}]}}]}));
  };
  const value=await generate(modelContext(fixture(),outside),{env,fetchImpl});
  assert.equal(value.plants.length,3);assert.equal(headers['x-goog-api-key'],'test-not-a-real-key');
  assert.equal(payload.generationConfig.responseMimeType,'application/json');assert.ok(payload.generationConfig.responseJsonSchema);
  await assert.rejects(generate({}, {env,fetchImpl:async()=>new Response('{"candidates":[{"finishReason":"MAX_TOKENS"}]}')}));
});
test('weather verifies timestamps/units and discloses unavailable data',async()=>{
  const now=Date.UTC(2026,9,24,4,0);
  const valid={utc_offset_seconds:28800,current:{time:'2026-10-24T12:00',temperature_2m:30,relative_humidity_2m:70,cloud_cover:40,is_day:1},daily:{}};
  const result=await weather({name:'test',latitude:1,longitude:2},{now,fetchImpl:async()=>new Response(JSON.stringify(valid))});
  assert.equal(result.status,'available');assert.equal(result.observed_at,'2026-10-24T04:00:00.000Z');
  const missing=await weather({name:'other',latitude:3,longitude:4},{now,fetchImpl:async()=>{throw Error('offline');}});
  assert.equal(missing.status,'unavailable');assert.equal('temperature_c' in missing,false);
});
test('HTTP care route requires app auth, caches reviews, and exposes no pump route',async(t)=>{
  const token='test-app-token-123456789012345';let calls=0;
  const server=createCareServer({env:{SPROUT_APP_TOKEN:token,SPROUT_PROVIDER:'test',SPROUT_MODEL:'test'},
    generateImpl:async()=>{calls++;return modelOutput();},weatherImpl:async()=>outside});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base='http://127.0.0.1:'+server.address().port;
  const send=(path,auth,body)=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});
  assert.equal((await send('/api/care/evaluate',false,fixture())).status,401);
  const first=await send('/api/care/evaluate',true,fixture());assert.equal(first.status,200);const a=await first.json();
  const second=await send('/api/care/evaluate',true,fixture());assert.equal((await second.json()).plan_id,a.plan_id);assert.equal(calls,1);
  assert.equal((await send('/api/water',true,{})).status,404);
});
