"use strict";
Object.assign(window.SolvexTranslations, {
  "Исследования":"Research", "Источники и новые вопросы по задаче":"Sources and better questions for your challenge",
  "Больше оснований.":"More evidence.", "Точнее следующий шаг.":"A clearer next step.",
  "Исследования, отраслевой опыт и решения — в контексте вашей задачи.":"Research, industry experience and solutions — connected to your challenge.",
  "Задача для исследования":"Research challenge", "Обновить результаты":"Refresh results", "Что искать в открытых источниках?":"What should we research?",
  "Например, причины расхождений складских остатков и успешные способы их снижения":"For example, causes of warehouse inventory discrepancies and proven ways to reduce them",
  "В поиск отправится этот запрос. Уберите названия компании, контакты и закрытые данные. Поиск расходует лимит API.":"This query will be sent to web search. Remove company names, contacts and confidential data. Searches use your API allowance.",
  "Найти источники ↗":"Find sources ↗", "Искать заново":"Search again", "Категории источников":"Source categories",
  "Что сообщил бизнес":"What the business shared", "Исходные сведения остаются отдельно от внешних выводов.":"Your information stays separate from external findings.",
  "Сохранённые основания":"Saved evidence", "Агент учитывает актуальные выводы для уточняющих вопросов. Карточка и рейтинг не меняются.":"The agent uses current insights for follow-up questions. Your challenge card and score stay unchanged.",
  "Загружаем исследования…":"Loading research…", "Сначала создайте задачу в чате.":"Start by creating a challenge in chat.", "Нет сохранённых задач":"No saved challenges",
  "В чате есть несохранённые правки. Здесь используется сохранённая карточка.":"You have unsaved changes in chat. Research uses the saved challenge.",
  "Ищем источники и связываем их с задачей… Можно вернуться позже — результат сохранится.":"Finding sources and connecting them to your challenge… You can return later; results will be saved.",
  "Поиск не выполнен. Прежние результаты сохранены.":"Search failed. Previous results are still available.", "Пока нет исследования":"No research yet",
  "Проверьте запрос выше и запустите поиск. Новые выводы появятся здесь.":"Review the query above and start a search. New insights will appear here.",
  "Источников: {0}":"Sources: {0}", "Факторов для проверки: {0}":"Factors to check: {0}", "Поиск от {0}":"Searched on {0}",
  "Карточка изменилась — проверьте применимость прежних выводов.":"The challenge changed — review whether these findings still apply.",
  "Исследованию больше суток. При необходимости обновите источники.":"This research is over a day old. Refresh sources if needed.",
  "Все материалы":"All materials", "Научные работы":"Scientific papers", "Отраслевой опыт":"Industry cases", "Похожие решения":"Similar solutions", "Другие материалы":"Other materials",
  "Связь с задачей":"Why it matters", "Внешнее основание":"External evidence", "Пересказ источника подготовлен AI. Проверьте оригинал; это не установленный факт о вашей компании.":"AI-generated source summary. Check the original; this is not an established fact about your company.",
  "Открыть источник ↗":"View source ↗", "Дата публикации не указана · просмотр {0}":"Publication date unavailable · accessed {0}",
  "Предположение для проверки":"A hypothesis to test", "Следующий вопрос":"Next question", "Ограничения применимости":"Scope and limitations",
  "Связанные сведения бизнеса":"Related business information", "По этому фактору ещё нет сведений бизнеса":"No business information about this factor yet",
  "Подтверждено пользователем":"Confirmed by the user", "Предоставлено пользователем":"Provided by the user",
  "Добавить к задаче":"Add insight to challenge", "На доске":"On your board", "Убрать с доски":"Remove from board",
  "Здесь пока нет сохранённых выводов":"No saved insights yet", "Выберите полезное основание в результатах — агент учтёт его в следующих вопросах.":"Save a useful insight from the results; the agent will consider it in follow-up questions.",
  "Поиск не дал материалов с проверяемыми ссылками. Измените запрос и попробуйте ещё раз.":"No material with verifiable links was returned. Adjust your query and try again.",
  "Источники найдены, но полезная связь с задачей не установлена.":"Sources were found, but no useful connection to the challenge was established.",
  "В этой категории пока нет выводов.":"No insights in this category yet.", "Все найденные источники":"All cited sources",
  "Данные бизнеса ещё не заполнены.":"No business information has been supplied yet.", "Сохранено для следующих вопросов агента":"Saved for the agent’s follow-up questions",
  "Устаревший контекст — агент не использует его в новых вопросах.":"Outdated context — the agent will not use it in new questions.",
  "Категории определены AI; наличие ссылки не гарантирует качество исследования.":"Categories are assigned by AI; a link does not guarantee research quality."
});
const rt=SolvexI18n.text;
SolvexI18n.staticText($("research"));
SolvexI18n.staticText($("agent-research"));
SolvexI18n.staticText(document.querySelector('[data-view="research"]'));
const research={generation:0,task:null,data:null,tasks:[],drafts:new Map(),filter:'all',poll:null,running:false};
const researchCategories={all:'Все материалы',scientific:'Научные работы',industry:'Отраслевой опыт',solution:'Похожие решения',other:'Другие материалы'};
function researchStatus(value,error=false){SolvexI18n.set($("research-status"),value);$("research-status").classList.toggle('error',error);}
function researchButton(label,fn,cls='secondary'){const button=el('button',rt(label),cls);button.type='button';button.onclick=fn;return button;}
function researchCurrent(generation,id,locale){return generation===research.generation&&research.task?.id===id&&SolvexI18n.locale===locale&&state.currentView==='research';}
async function loadResearch(preferred){
  clearTimeout(research.poll);const generation=++research.generation;
  const previous=research.task?.id;research.task=null;research.data=null;
  for(const id of ['research-form','research-output','evidence-board'])$(id).hidden=true;
  $("research-task").disabled=true;researchStatus(rt('Загружаем исследования…'));
  try{
    const {tasks}=await api('/api/me/tasks');
    if(generation!==research.generation||state.currentView!=='research')return;
    research.tasks=tasks;$("research-task").replaceChildren(...tasks.map(t=>SolvexI18n.option(t.card.title||rt('Без названия'),t.id)));
    if(!tasks.length){$("research-task").append(SolvexI18n.option(rt('Нет сохранённых задач'),''));researchStatus(rt('Сначала создайте задачу в чате.'));return;}
    const id=preferred||previous||state.taskId;
    if(tasks.some(t=>t.id===id))$("research-task").value=String(id);
    $("research-task").disabled=false;await fetchResearch();
  }catch(error){if(generation===research.generation)researchStatus(error.message,true);}
}
async function fetchResearch(preserve=false){
  clearTimeout(research.poll);const generation=++research.generation,id=Number($("research-task").value),locale=SolvexI18n.locale;
  research.task=research.tasks.find(t=>t.id===id);research.data=null;research.running=false;
  if(!research.task)return;
  $("research-output").hidden=true;$("evidence-board").hidden=true;$("research-form").hidden=false;
  $("research-run").disabled=true;$("research-fresh").hidden=true;
  if(!preserve)$("research-query").value=research.drafts.get(id)??research.task.card.title??'';
  researchStatus(rt('Загружаем исследования…'));
  try{
    const data=await api('/api/me/tasks/'+id+'/research?locale='+locale);
    if(!researchCurrent(generation,id,locale))return;
    research.data=data;
    if(!preserve&&!research.drafts.has(id)&&data.run?.query)$("research-query").value=data.run.query;
    renderResearch();scheduleResearch(generation,id,locale);
  }catch(error){if(researchCurrent(generation,id,locale))researchStatus(error.message,true);}
  finally{if(researchCurrent(generation,id,locale))$("research-run").disabled=!research.data||research.data.run?.status==='pending';}
}
function scheduleResearch(generation,id,locale){
  if(research.data?.run?.status!=='pending')return;
  research.poll=setTimeout(async()=>{
    if(!researchCurrent(generation,id,locale))return;
    try{const data=await api('/api/me/tasks/'+id+'/research?locale='+locale);if(!researchCurrent(generation,id,locale))return;research.data=data;renderResearch();scheduleResearch(generation,id,locale);}
    catch(error){if(researchCurrent(generation,id,locale))researchStatus(error.message,true);}
  },2200);
}
async function runResearch(refresh=false){
  if(!research.task||research.running||research.data?.run?.status==='pending'||!$("research-form").reportValidity())return;
  const id=research.task.id,generation=research.generation,locale=SolvexI18n.locale,query=$("research-query").value.trim();
  research.drafts.set(id,query);research.running=true;$("research-run").disabled=true;$("research-fresh").disabled=true;
  researchStatus(rt('Ищем источники и связываем их с задачей… Можно вернуться позже — результат сохранится.'));
  try{const data=await api('/api/me/tasks/'+id+'/research','POST',{query,locale,refresh,expected_revision:research.data.revision},110000);
    if(!researchCurrent(generation,id,locale))return;research.data=data;renderResearch();scheduleResearch(generation,id,locale);
  }catch(error){if(researchCurrent(generation,id,locale)){researchStatus(error.message,true);}}
  finally{if(researchCurrent(generation,id,locale)){research.running=false;$("research-run").disabled=!research.data||research.data.run?.status==='pending';$("research-fresh").disabled=false;}}
}
function researchSource(source){
  const box=el('div',null,'research-source'),link=el('a',source.title);link.href=source.url;link.target='_blank';link.rel='noopener noreferrer';
  box.append(link,el('small',source.domain),el('small',rt('Дата публикации не указана · просмотр {0}',new Date(source.accessed_at).toLocaleDateString(SolvexI18n.locale))));return box;
}
function insightCard(insight,report,index,saved=false){
  const card=el('article',null,'evidence-card');card.dataset.insightIndex=index;
  card.append(el('span',rt(researchCategories[insight.category]),'eyebrow'),el('h3',insight.factor));
  card.append(el('h4',rt('Связь с задачей')),el('p',insight.why));
  const facts=el('details',null,'evidence-facts');facts.append(el('summary',rt('Внешнее основание')),el('span','FACT','evidence-type fact-type'),el('p',rt('Пересказ источника подготовлен AI. Проверьте оригинал; это не установленный факт о вашей компании.'),'hint'));
  const passages=report.passages.filter(p=>insight.evidence_ids.includes(p.id));
  for(const passage of passages){facts.append(el('p',passage.text,'evidence-passage'));for(const id of passage.source_ids){const source=report.sources.find(s=>s.id===id);if(source)facts.append(researchSource(source));}}
  card.append(facts);
  const sourceIds=new Set(passages.flatMap(p=>p.source_ids)),links=el('div',null,'evidence-inline-sources');
  for(const source of report.sources.filter(s=>sourceIds.has(s.id))){const link=el('a',source.domain+' ↗');link.href=source.url;link.target='_blank';link.rel='noopener noreferrer';link.title=source.title;links.append(link);}card.append(links);
  const business=el('div',null,'evidence-business');business.append(el('span','BUSINESS DATA','evidence-type business-type'),el('h4',rt(insight.business_ids.length?'Связанные сведения бизнеса':'По этому фактору ещё нет сведений бизнеса')));
  for(const key of insight.business_ids){const data=report.business_data[key];if(data)business.append(el('p',data.text),el('small',rt(data.confirmed?'Подтверждено пользователем':'Предоставлено пользователем')));}card.append(business);
  const hypothesis=el('div',null,'evidence-hypothesis');hypothesis.append(el('span','HYPOTHESIS','evidence-type hypothesis-type'),el('p',insight.hypothesis));card.append(hypothesis);
  card.append(el('h4',rt('Ограничения применимости')),el('p',insight.limitations,'hint'));
  if(insight.question){const next=el('div',null,'evidence-question');next.append(el('span',rt('Следующий вопрос'),'eyebrow'),el('p',insight.question));card.append(next);}
  if(saved&&insight.stale)card.append(el('p',rt('Устаревший контекст — агент не использует его в новых вопросах.'),'evidence-stale'));
  const existing=research.data.saved.find(s=>s.run_id===report.id&&s.insight_index===index);
  const button=researchButton(saved?'Убрать с доски':existing?'На доске':'Добавить к задаче',event=>saveResearchInsight(event.currentTarget,report.id,index,saved?insight.id:null),saved?'text-button':'secondary');button.disabled=!saved&&Boolean(existing);card.append(button);return card;
}
async function saveResearchInsight(button,runId,index,removeId){
  const generation=research.generation,id=research.task.id,locale=SolvexI18n.locale;
  await action(button,async()=>{const data=await api('/api/me/tasks/'+id+'/evidence'+(removeId?'/'+removeId:''),removeId?'DELETE':'POST',removeId?{}:{run_id:runId,insight_index:index});
    if(!researchCurrent(generation,id,locale))return;research.data.saved=data.saved;renderResearch();if(!removeId)researchStatus(rt('Сохранено для следующих вопросов агента'));});
}
function renderResearch(){
  const data=research.data,report=data.report,pending=data.run?.status==='pending';
  $("research-run").disabled=pending;$("research-fresh").hidden=!report;$("research-fresh").disabled=pending;
  researchStatus(pending?rt('Ищем источники и связываем их с задачей… Можно вернуться позже — результат сохранится.'):data.run?.status==='failed'?SolvexI18n.failure({code:'AI_UNAVAILABLE',message:data.run.error}):state.dirty&&state.taskId===research.task.id?rt('В чате есть несохранённые правки. Здесь используется сохранённая карточка.'):'',data.run?.status==='failed');
  $("research-output").hidden=false;$("evidence-board").hidden=false;
  const summary=$("research-summary");summary.replaceChildren();
  if(report){summary.append(el('strong',rt('Источников: {0}',report.sources.length)),el('span',rt('Факторов для проверки: {0}',report.insights.length)),el('small',rt('Поиск от {0}',new Date(report.created_at).toLocaleString(SolvexI18n.locale))),el('p',report.query));
    if(report.stale)summary.append(el('p',rt('Карточка изменилась — проверьте применимость прежних выводов.'),'evidence-stale'));
    if(report.expired)summary.append(el('p',rt('Исследованию больше суток. При необходимости обновите источники.'),'hint'));}
  const filters=$("research-filters");filters.replaceChildren();
  if(report)for(const [key,label] of Object.entries(researchCategories)){const count=report.insights.filter(i=>key==='all'||i.category===key).length;const b=researchButton(label,()=>{research.filter=key;renderResearch();},'research-filter');b.append(el('span',String(count)));b.setAttribute('aria-pressed',String(research.filter===key));filters.append(b);}
  const list=$("research-insights");list.replaceChildren();
  if(!report){list.append(el('h2',rt('Пока нет исследования')),el('p',rt('Проверьте запрос выше и запустите поиск. Новые выводы появятся здесь.')));}
  else{
    let shown=0;report.insights.forEach((insight,index)=>{if(research.filter==='all'||research.filter===insight.category){list.append(insightCard(insight,report,index));shown++;}});
    if(!shown)list.append(el('p',rt(!report.sources.length?'Поиск не дал материалов с проверяемыми ссылками. Измените запрос и попробуйте ещё раз.':!report.insights.length?'Источники найдены, но полезная связь с задачей не установлена.':'В этой категории пока нет выводов.'),'research-empty'));
    if(report.sources.length){const all=el('details',null,'research-all-sources');all.append(el('summary',rt('Все найденные источники')),el('p',rt('Категории определены AI; наличие ссылки не гарантирует качество исследования.'),'hint'));report.sources.forEach(s=>all.append(researchSource(s)));list.append(all);}
  }
  const business=$("research-business-data");business.replaceChildren();
  const fields=Object.entries(data.business_data).filter(([key])=>key.startsWith('card:'));
  for(const [key,item] of fields){const field=el('div');field.append(el('h3',FIELDS[key.slice(5)]),el('p',item.text),el('small',rt(item.confirmed?'Подтверждено пользователем':'Предоставлено пользователем')));business.append(field);}
  if(!fields.length)business.append(el('p',rt('Данные бизнеса ещё не заполнены.')));
  const board=$("evidence-list");board.replaceChildren();SolvexI18n.set($("evidence-count"),data.saved.length);
  if(!data.saved.length)board.append(el('h3',rt('Здесь пока нет сохранённых выводов')),el('p',rt('Выберите полезное основание в результатах — агент учтёт его в следующих вопросах.')));
  for(const item of data.saved){const fold=el('details',null,'saved-evidence');fold.append(el('summary',item.factor),insightCard(item,{...item,id:item.run_id},item.insight_index,true));board.append(fold);}
}
$("research-task").onchange=()=>fetchResearch();
$("research-query").oninput=()=>{if(research.task)research.drafts.set(research.task.id,$("research-query").value);};
$("research-form").onsubmit=event=>{event.preventDefault();runResearch();};
$("research-fresh").onclick=()=>runResearch(true);
$("research-reload").onclick=()=>fetchResearch(true);
$("research-chat").onclick=()=>{const id=research.task?.id;if(!id||agent.task?.id===id){view('create');return;}openSavedTask(id).catch(error=>message(error.message,true));};
$("agent-research").onclick=()=>{if(state.busy)return;if(!agent.task){message(rt('Сначала создайте задачу в чате.'));return;}view('research',{taskId:agent.task.id});};
window.addEventListener('solvex:language',()=>{if(state.currentView==='research')fetchResearch(true);});
