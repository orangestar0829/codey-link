import {cardSchema,promptStart,promptStatus,promptLatest,promptConfirm} from './shared/contracts';
import {parseCard} from './shared/parse';
import {AttachmentCards} from './client/cards';
import {createPromptController} from './client/prompt-controller.mjs';
import {createPromptPanel} from './client/prompt-panel';
export default function contribute(client:any) {
  const controller = createPromptController({
    start:(input:any)=>client.rpc(promptStart,input),status:(input:any)=>client.rpc(promptStatus,input),
    latest:(input:any)=>client.rpc(promptLatest,input),send:(input:any)=>client.rpc(promptConfirm,input),
  });
  client.addWorkspacePanel({id:'prompt-optimize',title:'提示词优化',icon:'WandSparkles',context:'agent',Component:createPromptPanel(controller)});
  client.addSlashCommand({name:'optimize',description:'使用 Codey 优化提示词，确认后再发送',argumentHint:'原始需求',context:'agent',onSubmit(context:any) {
    if(context.args.trim()) controller.setInput(context.agent.id,context.args);
    context.openPanel('prompt-optimize');
    if(context.args.trim()) void controller.optimize(context.agent.id);
  }});
  client.addCommandCenterItem({id:'prompt-optimize',title:'Codey 提示词优化',icon:'WandSparkles',context:'agent',onSelect(context:any){context.openPanel('prompt-optimize');}});
  client.addTimelineTransformer({id:'mobile-images',query:{itemType:'assistant_message'},transform({item}:any) {
    const data=parseCard(item);
    if(!data)return;
    if(!data.images.length)return {items:[]};
    return {items:[{type:'plugin',kind:'mobile-images',version:1,data}]};
  }});
  client.addTimelineRenderer({kind:'mobile-images',version:1,schema:cardSchema,Component:AttachmentCards});
  return ()=>controller.dispose();
}
