import test from 'node:test';
import assert from 'node:assert/strict';
import {createDeviceRelay} from '../device-relay.mjs';
import {createCareServer} from '../server.mjs';

const env={SPROUT_DEVICE_ID:'plantcare-test',SPROUT_DEVICE_TOKEN:'device-only-private-test-token-12345678',SPROUT_APP_TOKEN:'app-only-private-test-token-1234567890'};
function telemetry() {
  return {schema_version:1,source:'device',device_id:'plantcare-test',boot_id:'boot-test',sample_sequence:4,sample_age_ms:200,
    control_sequence:40,control_age_ms:10,clock_synced:true,pump_outputs_enabled:true,manual_on_off:true,approved_watering:true,max_schedule_seconds:20,
    plants:[1,2,3].map((id)=>({id,species:['chinese_bamboo','pandakaki','calathea'][id-1],soil_raw:3000,soil_moisture_pct:20,calibrated:true,
      pump_running:false,schedule_enabled:false,schedule_hour:8,schedule_minute:0,watering_seconds:15,sensor_pin:14+id,relay_pin:[7,40,39][id-1],
      manual_token:'boot-test-0',cooldown_remaining_ms:0,faults:[]}))};
}
const packet=(value=telemetry(),acks=[],at=Date.now())=>({telemetry:value,acks,sent_at_ms:at,snapshot_age_ms:0});
const command=(id='command-test-1',path='/api/manual',fields={plant:'1',token:'boot-test-0'})=>({id,boot_id:'boot-test',path,fields});

test('online command needs an ESP32 confirmation, is delivered once, and ages telemetry',async(t)=>{
  let time=1800000000000;
  const relay=createDeviceRelay({env,now:()=>time});t.after(()=>relay.close());
  assert.throws(()=>relay.telemetry(),/offline/);
  relay.sync(packet(telemetry(),[],time));
  const pending=relay.command(command());let done=false;pending.then(()=>done=true);
  await Promise.resolve();assert.equal(done,false);
  const sync=relay.sync(packet(telemetry(),[],time));assert.equal(sync.commands.length,1);
  assert.equal(relay.sync(packet(telemetry(),[],time)).commands.length,0);
  relay.sync(packet(telemetry(),[{id:'command-test-1',status:200,error:''}],time));
  assert.equal((await pending).body.confirmed_by,'device');
  await relay.command(command());assert.equal(relay.sync(packet(telemetry(),[],time)).commands.length,0);
  time+=1000;assert.equal(relay.telemetry().sample_age_ms,1200);
  assert.equal(relay.telemetry().transport,'cloud');
  time+=6000;assert.throws(()=>relay.command(command('command-test-2')),/offline/);
});

test('Stop cancels an unconfirmed start; expired starts and commands from an old boot never replay',async(t)=>{
  let time=1800000000000;const relay=createDeviceRelay({env,now:()=>time});t.after(()=>relay.close());
  const sync=(data=telemetry())=>relay.sync(packet(data,[],time));sync();
  const start=relay.command(command()),stop=relay.command(command('stop-test-1','/api/stop',{plant:'1'}));
  assert.equal((await start).status,409);
  const outgoing=sync().commands;assert.equal(outgoing.length,1);assert.equal(outgoing[0].path,'/api/stop');
  time+=7000;sync();assert.equal((await stop).status,504);
  assert.equal(sync().commands.length,0);
  const next=relay.command(command('command-test-2'));
  const rebooted=telemetry();rebooted.boot_id='another-boot';sync(rebooted);
  assert.equal((await next).status,409);
  assert.throws(()=>relay.command(command('command-test-3')),/restarted/);
});

test('offline renewal cannot hold a command for later, and altered duplicate IDs are rejected',async(t)=>{
  let time=1800000000000;const relay=createDeviceRelay({env,now:()=>time});t.after(()=>relay.close());
  relay.sync(packet(telemetry(),[],time));
  const pending=relay.command(command());
  assert.throws(()=>relay.command(command('command-test-1','/api/stop',{plant:'1'})),/identifier/);
  time+=7000;
  assert.throws(()=>relay.command(command('renew-test-1','/api/manual/renew')),/offline/);
  assert.equal((await pending).status,504);
  assert.equal(relay.sync(packet(telemetry(),[],time)).commands.length,0);
});

test('the online HTTP connection separates app and device permissions and confirms a schedule save',async(t)=>{
  const server=createCareServer({env});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base='http://127.0.0.1:'+server.address().port;
  const request=(path,token,body)=>fetch(base+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  assert.equal((await request('/api/device/sync',env.SPROUT_APP_TOKEN,packet())).status,401);
  assert.equal((await request('/api/device/setup',env.SPROUT_DEVICE_TOKEN)).status,401);
  assert.equal((await request('/api/device/commands',env.SPROUT_DEVICE_TOKEN,command())).status,401);
  assert.equal((await request('/api/device/telemetry',env.SPROUT_APP_TOKEN)).status,503);
  assert.equal((await request('/api/device/sync',env.SPROUT_DEVICE_TOKEN,packet())).status,200);
  const saved=request('/api/device/commands',env.SPROUT_APP_TOKEN,command('schedule-test-1','/api/plant',{
    plant:'2',species:'pandakaki',schedule:'true',hour:'20',minute:'30',seconds:'20'}));
  // Wait for this local HTTP request to reach the server, without relying on an arbitrary sleep.
  let outgoing=[];
  for(let i=0;i<20&&!outgoing.length;i++)outgoing=(await (await request('/api/device/sync',env.SPROUT_DEVICE_TOKEN,packet())).json()).commands;
  assert.equal(outgoing[0].fields.seconds,'20');assert.equal(outgoing[0].fields.hour,'20');
  await request('/api/device/sync',env.SPROUT_DEVICE_TOKEN,packet(telemetry(),[{id:'schedule-test-1',status:200,error:''}]));
  const result=await (await saved).json();assert.equal(result.confirmed_by,'device');
  const snapshot=await (await request('/api/device/telemetry',env.SPROUT_APP_TOKEN)).json();assert.equal(snapshot.transport,'cloud');
  assert.equal(JSON.stringify(snapshot).includes(env.SPROUT_DEVICE_TOKEN),false);
  assert.equal((await request('/api/device/commands',env.SPROUT_APP_TOKEN,command('invalid-path','/api/network',{}))).status,400);
});


test('a delayed upload does not disguise stale control or sensor readings',()=>{
  const now=1800000000000;const relay=createDeviceRelay({env,now:()=>now});
  relay.sync({...packet(telemetry(),[],now-6000),snapshot_age_ms:1000});
  assert.throws(()=>relay.telemetry(),/offline/);
  assert.throws(()=>relay.command(command()),/offline/);
  assert.throws(()=>relay.sync(packet(telemetry(),[],now+6000)),/freshness/);
  relay.close();
});
