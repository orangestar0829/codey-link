import {defineRpc} from '@getpaseo/plugin';
import {z} from 'zod';
export const asset = defineRpc({
  name:'image.read',
  input:z.object({key:z.string().regex(/^[a-f0-9]{64}$/),original:z.boolean()}),
  output:z.object({dataUri:z.string(),width:z.number(),height:z.number(),left:z.number(),top:z.number(),imageWidth:z.number(),imageHeight:z.number(),originalWidth:z.number(),originalHeight:z.number(),name:z.string(),bytes:z.number()}),
});
export const cardSchema=z.object({images:z.array(z.object({key:z.string(),label:z.string()})),unavailable:z.array(z.string())});

const promptIdentity = z.object({requestId:z.string().regex(/^[a-zA-Z0-9-]{8,128}$/),agentId:z.string().min(1).max(128)});
const promptResult = z.object({requestId:z.string(),phase:z.enum(['running','ready','failed','missing','rejected','sending','sent','send-unknown']),original:z.string(),optimized:z.string(),error:z.string()});
export const promptStart = defineRpc({name:'prompt.start',input:promptIdentity.extend({text:z.string().trim().min(1).max(32768)}),output:promptResult});
export const promptStatus = defineRpc({name:'prompt.status',input:promptIdentity,output:promptResult});
export const promptLatest = defineRpc({name:'prompt.latest',input:z.object({agentId:z.string().min(1).max(128)}),output:promptResult});
export const promptConfirm = defineRpc({name:'prompt.confirm',input:promptIdentity.extend({text:z.string().trim().min(1).max(65536)}),output:promptResult});
