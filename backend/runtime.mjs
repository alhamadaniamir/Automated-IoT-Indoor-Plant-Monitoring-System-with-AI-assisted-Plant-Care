export function cloudRuntime(env=process.env) {
  return env.SPROUT_DEPLOYMENT==='cloud'||env.RENDER==='true'||Boolean(env.PORT);
}
export function serverAddress(env=process.env) {
  const raw=env.SPROUT_PORT??env.PORT??'8765';
  if(!/^\d+$/.test(String(raw))||Number(raw)<1||Number(raw)>65535)throw new Error('Set a valid service port from 1 to 65535.');
  return {host:env.SPROUT_HOST||(cloudRuntime(env)?'0.0.0.0':'127.0.0.1'),port:Number(raw)};
}
