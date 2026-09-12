import React, {useEffect, useState, useSyncExternalStore} from 'react';
import {ActivityIndicator, Pressable, Text, View} from 'react-native';
import {useAgent} from '@getpaseo/plugin/client';
import {ScrollView, TextInput, copyText} from '@getpaseo/plugin/client/react-native';

export function createPromptPanel(controller:any) {
  return function PromptPanel(props:any) {
    const agent=useAgent(props.agentId,(value:any)=>({title:value.title}));
    return <PromptEditor {...props} controller={controller} agentTitle={agent?.title} canSend={!!agent}/>;
  };
}

export function PromptEditor({agentId, theme, navigation, controller, agentTitle, canSend}:any) {
    const draft = useSyncExternalStore(controller.subscribe, () => controller.get(agentId));
    const [copyMessage, setCopyMessage] = useState('');
    useEffect(()=>{setCopyMessage('');void controller.restore(agentId);},[agentId]);
    const busy = draft.phase === 'optimizing' || draft.phase === 'sending';
    const field = {color:theme.colors.foreground, backgroundColor:theme.colors.surface1, borderColor:theme.colors.border,
      borderWidth:1, borderRadius:12, padding:12, minHeight:112, textAlignVertical:'top' as const, fontSize:15};
    const button = (label:string, action:()=>void, disabled=false, primary=false) => <Pressable accessibilityRole="button" accessibilityLabel={label}
      disabled={disabled} onPress={action} style={{paddingHorizontal:16, paddingVertical:12, borderRadius:10,
        backgroundColor:primary?theme.colors.accent:theme.colors.surface1, opacity:disabled?0.45:1}}>
      <Text style={{color:primary?theme.colors.accentForeground:theme.colors.foreground}}>{label}</Text>
    </Pressable>;
    return <ScrollView style={{flex:1, backgroundColor:theme.colors.surface0}} keyboardShouldPersistTaps="handled"
      contentContainerStyle={{padding:16, gap:16, paddingBottom:32}}>
      <Text style={{color:theme.colors.foreground, fontSize:19, fontWeight:'600'}}>提示词优化</Text>
      <Text numberOfLines={2} style={{color:theme.colors.foregroundMuted, fontSize:13}}>目标会话：{agentTitle || '当前会话'}</Text>
      <Text style={{color:theme.colors.foregroundMuted, fontSize:13}}>沿用电脑 Codey 的优化配置。确认后才发送。</Text>
      <View style={{gap:8}}>
        <Text style={{color:theme.colors.foreground}}>原始需求</Text>
        <TextInput accessibilityLabel="原始需求" multiline value={draft.input} editable={!busy} maxLength={32768}
          onChangeText={(value:string)=>{setCopyMessage('');controller.setInput(agentId,value);}} style={field} placeholder="输入或粘贴需要优化的文本"
          placeholderTextColor={theme.colors.foregroundMuted}/>
      </View>
      <View style={{flexDirection:'row', flexWrap:'wrap', alignItems:'center', gap:10}}>
        {button('优化', ()=>{setCopyMessage('');void controller.optimize(agentId);}, busy || draft.phase==='waiting' || !draft.input.trim(), true)}
        {['waiting','send-unknown'].includes(draft.phase) && draft.requestId?button('刷新结果', ()=>{void controller.refresh(agentId);}):null}
        {busy?<ActivityIndicator color={theme.colors.accent}/>:null}
        {draft.phase==='optimizing'?<Text style={{color:theme.colors.foregroundMuted}}>正在优化…</Text>:null}
      </View>
      {draft.error?<Text accessibilityRole="alert" style={{color:theme.colors.statusDanger}}>{draft.error}</Text>:null}
      {draft.output?<View style={{gap:12}}>
        <Text style={{color:theme.colors.foreground}}>优化结果 · 可继续编辑</Text>
        <TextInput accessibilityLabel="优化结果" multiline value={draft.output} editable={!busy} maxLength={65536}
          onChangeText={(value:string)=>{setCopyMessage('');controller.setOutput(agentId,value);}} style={{...field,minHeight:180}}/>
        <View style={{flexDirection:'row', flexWrap:'wrap', gap:10}}>
          {button(draft.phase==='sent'?'已发送':'确认发送', ()=>{void controller.send(agentId);}, busy || draft.sendAttempted || !canSend || !draft.output.trim(), true)}
          {button('复制结果', ()=>{void copyText(draft.output).then(()=>setCopyMessage('已复制'),()=>setCopyMessage('复制失败，请长按文本复制'));})}
          {navigation?.openAgent?button('返回会话', ()=>navigation.openAgent({agentId})):null}
        </View>
        {copyMessage?<Text style={{color:theme.colors.foregroundMuted}}>{copyMessage}</Text>:null}
        {draft.phase==='sent'?<Text style={{color:theme.colors.statusSuccess}}>已发送到上面的目标会话。</Text>:null}
      </View>:null}
      <Text style={{color:theme.colors.foregroundMuted, fontSize:12}}>此面板只处理文本。图片与文件请在原消息框中添加；需要保留附件时，可复制优化结果后回到消息框发送。</Text>
    </ScrollView>;
}
