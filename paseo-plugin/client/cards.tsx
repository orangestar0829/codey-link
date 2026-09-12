import React, {useEffect,useRef,useState} from 'react';
import {ActivityIndicator,Image,Pressable,Text,View,useWindowDimensions} from 'react-native';
import {useQuery} from '@tanstack/react-query';
import {useRpc} from '@getpaseo/plugin/client';
import {Modal,ScrollView} from '@getpaseo/plugin/client/react-native';
import {asset} from '../shared/contracts';

function Picture({entry,theme,host}:any) {
  const read=useRpc(asset);
  const thumbnail=useQuery({queryKey:['codey-link-thumbnail',host.id,entry.key],queryFn:()=>read({key:entry.key,original:false}),staleTime:Infinity,gcTime:300000,retry:false});
  const [open,setOpen]=useState(false),[full,setFull]=useState<any>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false),[zoom,setZoom]=useState(1);
  const generation=useRef(0);
  const viewport=useWindowDimensions();
  useEffect(()=>()=>{generation.current++;},[]);
  async function showOriginal() {
    const request=++generation.current;
    setOpen(true);setFull(null);setError('');setLoading(true);setZoom(1);
    try {const result=await read({key:entry.key,original:true});if(request===generation.current)setFull(result);}
    catch(e:any){if(request===generation.current)setError(e.message||'原图读取失败');}
    finally {if(request===generation.current)setLoading(false);}
  }
  function close(value:boolean) {setOpen(value);if(!value){generation.current++;setFull(null);setLoading(false);setError('');}}
  const preview=thumbnail.data;
  const scale=preview?Math.min(84/preview.imageWidth,84/preview.imageHeight):1;
  // 原图按可用宽度打开，长截图纵向滚动，避免再次缩成难以阅读的一条。
  const fit=full?Math.min(Math.max(120,viewport.width-64)/full.width,1):1;
  const button=(label:string,action:()=>void)=><Pressable onPress={action} accessibilityRole="button" style={{padding:10}}><Text style={{color:theme.colors.foreground}}>{label}</Text></Pressable>;
  return <View style={{gap:4}}>
    <Pressable accessibilityRole="button" accessibilityLabel="打开原图" onPress={showOriginal} style={{width:84,height:84,borderRadius:10,overflow:'hidden',alignItems:'center',justifyContent:'center',backgroundColor:theme.colors.surface1}}>
      {preview?<View style={{width:preview.imageWidth*scale,height:preview.imageHeight*scale,overflow:'hidden'}}>
        <Image source={{uri:preview.dataUri}} style={{position:'absolute',left:-preview.left*scale,top:-preview.top*scale,width:preview.width*scale,height:preview.height*scale}} />
      </View>:thumbnail.isError?<Text style={{color:theme.colors.foregroundMuted,fontSize:12}}>预览失败</Text>:<ActivityIndicator />}
    </Pressable>
    {thumbnail.isError?button('重试预览',()=>{void thumbnail.refetch()}):<Text style={{color:theme.colors.foregroundMuted,fontSize:11,textAlign:'center'}}>点击查看原图</Text>}
    <Modal title="图片" open={open} onOpenChange={close}>
      <Modal.Content>
        {loading?<View style={{padding:30,gap:12,alignItems:'center'}}><ActivityIndicator/><Text style={{color:theme.colors.foregroundMuted}}>正在读取原图…</Text></View>:null}
        {error?<View><Text style={{color:theme.colors.foreground}}>{error}</Text>{button('重试',showOriginal)}</View>:null}
        {full?<View style={{gap:12}}>
          <View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between'}}>
            {button('缩小',()=>setZoom(value=>Math.max(1,value/2)))}
            <Text style={{color:theme.colors.foregroundMuted}}>{Math.round(fit*zoom*100)}%</Text>
            {button('放大',()=>setZoom(value=>Math.min(16,value*2)))}
          </View>
          <ScrollView horizontal contentContainerStyle={{flexGrow:1,justifyContent:'center'}}>
            <Image source={{uri:full.dataUri}} resizeMode="contain" style={{width:full.width*fit*zoom,height:full.height*fit*zoom}} />
          </ScrollView>
          <Text style={{color:theme.colors.foregroundMuted,fontSize:12}}>{full.width} × {full.height} · {(full.bytes/1024/1024).toFixed(2)} MiB</Text>
        </View>:null}
      </Modal.Content>
    </Modal>
  </View>;
}

export function AttachmentCards({item,theme,host}:any) {
  return <View style={{alignSelf:'flex-end',maxWidth:'92%',flexDirection:'row',flexWrap:'wrap',gap:10,padding:8}}>
    {item.data.images.map((entry:any)=><Picture key={entry.key} entry={entry} theme={theme} host={host}/>)}
  </View>;
}
