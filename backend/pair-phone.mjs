import {readFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {parseEnv} from 'node:util';
import {spawnSync} from 'node:child_process';

const device=process.argv[2];
if(!device||!/^[A-Za-z0-9_.:-]+$/.test(device))throw Error('Pass the Android device ID from adb devices.');
const env=parseEnv(await readFile(join(homedir(),'.config','sprout','backend.env'),'utf8'));
if(!env.SPROUT_APP_TOKEN||env.SPROUT_APP_TOKEN.length<24)throw Error('Run node backend/prepare.mjs first.');
let address=process.argv[3]||'http://127.0.0.1:8765';
if(address==='--render')address=JSON.parse(await readFile(join(homedir(),'.config','sprout','render-service.json'),'utf8')).url;
const endpoint=new URL(address);
if(endpoint.username||endpoint.password||endpoint.search||endpoint.hash||!['','/'].includes(endpoint.pathname)||
 !(endpoint.protocol==='https:'||(endpoint.protocol==='http:'&&endpoint.hostname==='127.0.0.1'&&endpoint.port==='8765')))
 throw Error('Use the Render HTTPS address, or the local USB service.');
address=endpoint.origin;
function adb(args,input){const result=spawnSync('adb',['-s',device,...args],{input,encoding:'utf8'});if(result.status!==0)throw Error('USB pairing failed. Unlock the phone and check USB debugging authorization.');}
if(endpoint.protocol==='http:')adb(['reverse','tcp:8765','tcp:8765']);
adb(['shell','run-as','com.example.plant_care_mobile','mkdir','-p','files']);
adb(['shell','run-as','com.example.plant_care_mobile','sh','-c',"'cat > files/care-pairing.json'"],JSON.stringify({base_url:address,access_token:env.SPROUT_APP_TOKEN}));
console.log(endpoint.protocol==='https:'?'Configured online AI at '+address+'. Reopen Sprout; ongoing AI use does not require USB or the laptop.':'Paired the Android app to the laptop care service over USB.');
console.log('No provider key was copied to the phone.');
