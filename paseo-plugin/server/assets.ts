import {open,readFile,realpath,stat} from 'node:fs/promises';
import path from 'node:path';
export async function readAsset(input:{key:string,original:boolean},root:string,maxOriginalBytes=20*1024*1024) {
  try { return await readAssetFile(input,root,maxOriginalBytes); }
  catch(error:any) {
    if(error.code==='ENOENT')throw new Error('图片或附件索引已失效，请刷新会话');
    if(error.code==='EACCES'||error.code==='EPERM')throw new Error('电脑端无法读取这张图片');
    throw error;
  }
}

async function readAssetFile(input:{key:string,original:boolean},root:string,maxOriginalBytes:number) {
  if(!/^[a-f0-9]{64}$/.test(input.key))throw new Error('无效的附件标识');
  const cache=await realpath(path.join(root,'image-previews'));
  const receiptFile=await realpath(path.join(cache,input.key+'.json'));
  if(path.dirname(receiptFile)!==cache)throw new Error('附件标识不可用');
  const receipt=JSON.parse(await readFile(receiptFile,'utf8'));
  if(receipt.version!==1||typeof receipt.source!=='string')throw new Error('附件信息已失效，请刷新会话');
  const dimensions=['width','height','imageWidth','imageHeight','originalWidth','originalHeight'];
  if(dimensions.some(key=>!Number.isSafeInteger(receipt[key])||receipt[key]<=0)||
      !Number.isSafeInteger(receipt.left)||!Number.isSafeInteger(receipt.top)||receipt.left<0||receipt.top<0||
      receipt.left+receipt.imageWidth>receipt.width||receipt.top+receipt.imageHeight>receipt.height)throw new Error('预览尺寸已失效，请刷新会话');
  const source=await stat(receipt.source);
  if(!source.isFile()||source.size!==receipt.sourceSize||source.mtimeMs!==receipt.sourceMtimeMs)throw new Error('原图已变更或失效，请刷新会话');
  const file=input.original?receipt.source:await realpath(path.join(cache,input.key+'.jpg'));
  if(!input.original&&path.dirname(file)!==cache)throw new Error('预览文件不可用');
  const handle=await open(file,'r');
  let data:Buffer;
  try {
    const size=(await handle.stat()).size;
    const limit=input.original?maxOriginalBytes:256*1024;
    if(size>limit)throw new Error(input.original?'原图超过查看限制，请调整 CODEY_LINK_IMAGE_OPEN_MAX_MIB 后重启':'缩略图超过读取限制');
    data=Buffer.alloc(size);let offset=0;
    while(offset<size){const read=await handle.read(data,offset,size-offset,offset);if(!read.bytesRead)throw new Error('文件读取不完整');offset+=read.bytesRead;}
    const after=await handle.stat();
    if(after.size!==size||(input.original&&after.mtimeMs!==receipt.sourceMtimeMs))throw new Error('读取时文件发生变化');
  } finally {await handle.close();}
  const mime=data.subarray(0,3).equals(Buffer.from([255,216,255]))?'image/jpeg':data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'image/png':data.subarray(0,6).toString().startsWith('GIF8')?'image/gif':data.subarray(0,4).toString()==='RIFF'&&data.subarray(8,12).toString()==='WEBP'?'image/webp':null;
  if(!mime)throw new Error('此图片格式暂不支持预览');
  return {dataUri:`data:${mime};base64,${data.toString('base64')}`,width:input.original?receipt.originalWidth:receipt.width,height:input.original?receipt.originalHeight:receipt.height,left:input.original?0:receipt.left,top:input.original?0:receipt.top,imageWidth:input.original?receipt.originalWidth:receipt.imageWidth,imageHeight:input.original?receipt.originalHeight:receipt.imageHeight,originalWidth:receipt.originalWidth,originalHeight:receipt.originalHeight,name:path.basename(receipt.source),bytes:data.length};
}
