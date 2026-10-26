import {readFile,writeFile,mkdir,chmod,rename,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {parseEnv} from 'node:util';

export async function prepareOnlineDevice(directory,deviceId) {
  if(!/^plantcare-[a-z0-9-]{1,40}$/.test(deviceId))throw new Error('Use the device ID printed by the plant sketch.');
  const path=join(directory,'backend.env');
  const existing=parseEnv(await readFile(path,'utf8'));
  if(!existing.SPROUT_APP_TOKEN)throw new Error('Configure Sprout AI first.');
  if(existing.SPROUT_DEVICE_ID&&existing.SPROUT_DEVICE_ID!==deviceId)throw new Error('A different device is already paired. Review the pairing before replacing it.');
  existing.SPROUT_DEVICE_ID=deviceId;
  existing.SPROUT_DEVICE_TOKEN ||= randomBytes(32).toString('hex');
  if(existing.SPROUT_DEVICE_TOKEN===existing.SPROUT_APP_TOKEN)throw new Error('The device needs a separate private token.');
  const content=Object.entries(existing).map(([key,value])=>{
    if(!/^[A-Z_][A-Z0-9_]*$/.test(key)||/[\r\n"\\]/.test(value))throw new Error('Unexpected private configuration format.');
    return key+'="'+value+'"';
  }).join('\n')+'\n';
  await mkdir(directory,{recursive:true,mode:0o700});await chmod(directory,0o700);
  const temporary=path+'.'+randomBytes(8).toString('hex')+'.tmp';
  try {await writeFile(temporary,content,{flag:'wx',mode:0o600});await rename(temporary,path);}
  finally {await unlink(temporary).catch(()=>{});}
  return {device_id:deviceId,configured:true};
}
