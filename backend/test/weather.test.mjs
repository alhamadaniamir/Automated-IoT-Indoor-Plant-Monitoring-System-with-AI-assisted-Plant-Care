import test from 'node:test';
import assert from 'node:assert/strict';
import {weather,validateWeatherLocation} from '../weather.mjs';
import {createCareServer} from '../server.mjs';

test('weather failures expose a bounded reason without leaking provider text or invented measurements',async()=>{
  const cases=[
    [async()=>new Response('provider text that must stay private',{status:429}),'http_429'],
    [async()=>{throw new DOMException('request detail','TimeoutError');},'timeout'],
    [async()=>{throw new Error('private network detail');},'network_error'],
    [async()=>new Response('broken JSON'),'invalid_response'],
    [async()=>new Response('{}'),'invalid_data'],
    [async()=>Response.json({current:{time:'2000-01-01T00:00',temperature_2m:25,relative_humidity_2m:70,cloud_cover:25,is_day:1},utc_offset_seconds:0}),'stale_data'],
  ];
  for (let i=0;i<cases.length;i++) {
    const [fetchImpl,reason]=cases[i];
    const result=await weather({name:'test',latitude:20+i,longitude:10},{fetchImpl});
    assert.equal(result.status,'unavailable');assert.equal(result.failure_reason,reason);
    assert.equal('temperature_c' in result,false);assert.doesNotMatch(JSON.stringify(result),/private|provider text/);
  }
});

test('weather checks validate locations and require app authentication without invoking Gemini',async(t)=>{
  for (const location of [null,{name:'test',latitude:'8',longitude:124},{name:'test',latitude:91,longitude:124}])
    assert.throws(()=>validateWeatherLocation(location));
  const token='test-weather-access-token-12345';let calls=0;
  const server=createCareServer({env:{SPROUT_APP_TOKEN:token},
    generateImpl:async()=>{throw Error('Weather checks must not invoke Gemini');},
    weatherImpl:async(location)=>{calls++;return {status:'available',source:'test',location:location.name};}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const url='http://127.0.0.1:'+server.address().port+'/api/weather';
  const request=(value,authorized=true)=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json',...(authorized?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(value)});
  const value={location:{name:'Cagayan de Oro',latitude:8.48222,longitude:124.64722}};
  assert.equal((await request(value,false)).status,401);
  assert.equal((await request({location:{name:'invalid',latitude:200,longitude:0}})).status,400);
  const response=await request(value);assert.equal(response.status,200);
  assert.equal((await response.json()).location,'Cagayan de Oro');assert.equal(calls,1);
});
