import {homedir} from 'node:os';
import {join} from 'node:path';
import {prepareOnlineDevice} from './online-setup.mjs';
try {
  const id=process.argv.find(x=>x.startsWith('--device='))?.slice(9);
  console.log(JSON.stringify(await prepareOnlineDevice(join(homedir(),'.config','sprout'),id)));
  console.log('Saved private device pairing. No keys were printed or added to the project.');
}catch(error){console.error(error.message);process.exitCode=1;}
