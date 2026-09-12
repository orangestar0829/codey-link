// 只认桥接生成的附件行，不把普通回复里的路径或图片变成可读文件请求。
export function parseCard(item:any) {
  if(typeof item.messageId!=='string'||!item.messageId.startsWith('codey-link-user-images-')||typeof item.text!=='string')return;
  const heading='**用户附件**';
  let text=item.text.trim();
  // 实时消息会按 Markdown 段落拆开；历史快照则保留整条消息。
  if(text===heading)return {images:[],unavailable:[]};
  if(text.startsWith(heading))text=text.slice(heading.length).trim();
  const images:{key:string,label:string}[]=[];
  const consumed:string[]=[];
  const pattern=/!\[([^\n]*)\]\((file:[^)]+)\)\s*\n\s*\[查看原图(?:[^\]]*)\]\((file:[^)]+)\)（[^\n]+）/g;
  for(const match of text.matchAll(pattern)) {
    const key=match[2].match(/\/image-previews\/([a-f0-9]{64})\.jpg$/)?.[1];
    if(!key)continue;
    images.push({key,label:match[1].replace(/（缩略图）$/,'')});consumed.push(match[0]);
  }
  if(!images.length) {
    // 兼容已缓存的旧版独立图片段。独立原图链接继续保留，避免丢失文件入口。
    const match=/^!\[([^\n]*)\]\((file:[^)]+)\)$/.exec(text);
    const key=match?.[2].match(/\/image-previews\/([a-f0-9]{64})\.jpg$/)?.[1];
    return key?{images:[{key,label:match![1].replace(/（缩略图）$/,'')}],unavailable:[]}:undefined;
  }
  let remaining=text;
  for(const part of consumed)remaining=remaining.replace(part,'');
  // 混合普通文件和超限图片保留原显示，避免吞掉既有文件入口。
  if(remaining.trim())return;
  return {images,unavailable:[]};
}
