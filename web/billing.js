"use strict";
let billingData=null,billingLoading=false,billingGeneration=0;
const usageStrips={};
for(const [kind,before] of [['chat',$('chat-form')],['research',$('research-form')]]){
  const box=el('div',null,'usage-strip');box.setAttribute('aria-live','polite');before.before(box);usageStrips[kind]=box;
}
function renderUsage(){
  if(!billingData)return;const t=SolvexI18n.text;
  for(const [kind,box] of Object.entries(usageStrips)){
    const count=billingData.usage[kind];box.replaceChildren();box.classList.toggle('limit-reached',count.remaining===0);
    box.append(el('span',kind==='chat'?t('AI-запросы'):t('Исследования')),el('strong',count.remaining===0?t('Лимит на сегодня использован'):t('Осталось сегодня: {0} / {1}',count.remaining,count.limit)));
    const link=el('button',t('Тарифы →'),'text-button');link.type='button';link.onclick=()=>view('billing');box.append(link);
  }
  const target=$('billing-usage');target.replaceChildren();
  for(const [kind,count] of Object.entries(billingData.usage)){
    const card=el('article',null,'usage-card');card.append(el('h2',t(kind==='chat'?'AI-запросы сегодня':'Исследования сегодня')),el('strong',t('Осталось {0} из {1}',count.remaining,count.limit)));
    const meter=el('meter');meter.min=0;meter.max=count.limit;meter.value=count.remaining;SolvexI18n.attribute(meter,'aria-label',t('Осталось {0} из {1}',count.remaining,count.limit));card.append(meter);
    if(count.reserved)card.append(el('p',t('В обработке: {0}',count.reserved)));target.append(card);
  }
  const reset=new Date(billingData.resets_at).toLocaleString(SolvexI18n.locale,{timeZone:'Asia/Almaty',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})+' (UTC+05:00)';
  SolvexI18n.set($('billing-status'),t('Следующее обновление лимита: {0}',reset));
  if(billingData.expires_at)target.append(el('p',t('Доступ Plus до {0}',new Date(billingData.expires_at).toLocaleDateString(SolvexI18n.locale))));
  SolvexPlans.render($('billing-plans'),billingData,billingData.plan);
}
async function loadUsage(){
  if(!state.user||billingLoading)return;billingLoading=true;const generation=++billingGeneration,userId=state.user.id;
  try{const data=await api('/api/me/subscription');if(userId!==state.user?.id||generation!==billingGeneration)return;billingData=data;renderUsage();}
  catch(error){if(!billingData){for(const box of Object.values(usageStrips)){box.replaceChildren();const retry=el('button',SolvexI18n.text('Не удалось загрузить лимиты. Повторить'),'text-button');retry.type='button';retry.onclick=loadUsage;box.append(retry);}}if(state.currentView==='billing')SolvexI18n.set($('billing-status'),error.message);}
  finally{billingLoading=false;}
}
window.addEventListener('solvex:usage',loadUsage);
window.addEventListener('solvex:quota',event=>{billingData=event.detail;renderUsage();});
window.addEventListener('solvex:language',renderUsage);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)loadUsage();});
setInterval(()=>{if(!document.hidden&&['create','research','billing','business'].includes(state.currentView))loadUsage();},30000);
