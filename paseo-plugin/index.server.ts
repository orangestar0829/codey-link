import {asset,promptStart,promptStatus,promptLatest,promptConfirm} from './shared/contracts';
import {readAsset} from './server/assets';
import {optimizeWithCodey} from './server/codey-prompt.mjs';
import {createPromptJobs} from './server/prompt-jobs.mjs';
export default function contribute(server:any) {
  const jobs = createPromptJobs(optimizeWithCodey);
  server.handle(promptStart,(input:any)=>jobs.start(input));
  server.handle(promptStatus,(input:any)=>jobs.status(input));
  server.handle(promptLatest,(input:any)=>jobs.latest(input));
  server.handle(promptConfirm,(input:any,{paseo}:any)=>jobs.confirm(input,(agentId:string,text:string)=>paseo.agents.ref(agentId).send(text)));
  server.handle(asset,async (input:any)=>{
    const root=process.env.PASEO_HOME;
    if(!root)throw new Error('未找到 CodeyLink 专用服务目录');
    const configured=Number(process.env.CODEY_LINK_IMAGE_OPEN_MAX_MIB??20);
    if(!Number.isInteger(configured)||configured<1||configured>1024)throw new Error('CODEY_LINK_IMAGE_OPEN_MAX_MIB 必须为 1–1024');
    return readAsset(input,root,configured*1024*1024);
  });
  return ()=>jobs.dispose();
}
