"use strict";

Object.assign(window.SolvexTranslations, {
  "Проекты":"Projects", "От договорённости к результату":"From agreement to delivery", "Работа, которая движется.":"Work that moves forward.",
  "Общая дорожная карта бизнеса и команды. Каждый этап — понятный следующий шаг.":"A shared roadmap for the business and the team. Every milestone is a clear next step.",
  "Обновить проекты":"Refresh projects", "Начать проект →":"Start project →", "Открыть проект →":"Open project →", "Загружаем проекты…":"Loading projects…",
  "Здесь начинается совместная работа":"Working together starts here", "Выберите команду в откликах и нажмите «Начать проект».":"Select a team in proposals and click Start project.",
  "Проект появится здесь, когда бизнес начнёт работу по вашему выбранному отклику.":"Your project will appear here when the business starts work on your selected proposal.",
  "В работе":"In progress", "Завершён":"Completed", "Принято этапов: {0} / {1}":"Milestones accepted: {0} / {1}", "На проверке: {0}":"Awaiting review: {0}",
  "Ваш общий маршрут":"Your shared roadmap", "Дорожная карта":"Roadmap", "Добавить этап":"Add milestone", "Завершить проект":"Complete project", "Открыть снова":"Reopen project",
  "Сначала задайте первый этап":"Set the first milestone", "Опишите результат, который хотите получить. Срок можно добавить позже.":"Describe the result you expect. You can add a deadline later.",
  "Бизнес готовит дорожную карту. Обновите проект, чтобы увидеть новые этапы.":"The business is preparing the roadmap. Refresh to see new milestones.",
  "Запланирован":"Planned", "На проверке":"In review", "Нужны доработки":"Changes requested", "Принят":"Accepted", "Без срока":"No deadline", "Срок прошёл":"Overdue",
  "Ожидаемый результат этапа":"Expected milestone result", "Результат команды":"Team delivery", "Открыть результат ↗":"Open delivery ↗", "Замечания бизнеса":"Business feedback",
  "Редактировать этап":"Edit milestone", "Взять в работу":"Start work", "Сдать результат":"Submit delivery", "Принять результат":"Accept delivery", "Вернуть на доработку":"Request changes",
  "Договорённости на старте":"Starting agreement", "Снимок задачи и отклика на момент создания проекта.":"A snapshot of the challenge and proposal when the project was created.",
  "Предложенный срок: {0} дн.":"Proposed duration: {0} days", "Участники":"Participants", "Бизнес":"Business", "Журнал работы":"Activity history",
  "Проект создан":"Project created", "Этап добавлен":"Milestone added", "Этап изменён":"Milestone edited", "Этап начат":"Work started", "Результат отправлен":"Delivery submitted", "Этап принят":"Milestone accepted", "Запрошены доработки":"Changes requested", "Проект завершён":"Project completed", "Проект открыт снова":"Project reopened",
  "Название этапа":"Milestone title", "Что должно быть готово":"What should be delivered", "Срок (необязательно)":"Deadline (optional)", "Описание результата":"Delivery description", "Ссылка на результат (необязательно)":"Delivery link (optional)", "Что нужно доработать":"What needs to change",
  "Сохранить этап":"Save milestone", "Отправить результат":"Submit delivery", "Отправить замечания":"Send feedback", "Отмена":"Cancel", "Закрыть":"Close",
  "Изменения формы не сохранены. Закрыть её?":"Your form changes are not saved. Close it?", "Сохраняем…":"Saving…", "Изменения сохранены":"Changes saved",
  "Проект изменился. Закройте форму и обновите проект. Перед этим скопируйте свой текст.":"The project changed. Copy your text before closing the form and refreshing the project.",
  "При первой приёмке — +10 команде за отклик. Повторно баллы не начисляются.":"The first acceptance awards 10 points for this proposal. Points are awarded only once.",
  "Баллы за этот отклик уже начислены.":"Points for this proposal have already been awarded.", "История сдач и замечаний сохраняется здесь.":"All deliveries and feedback are recorded here.",
  "Завершение доступно после приёмки всех этапов.":"Complete the project after accepting every milestone.", "Показать всю историю":"Show full history"
});
const pt = SolvexI18n.text;
SolvexI18n.staticText($("projects"));
SolvexI18n.staticText(document.querySelector('[data-view="projects"]'));
const projects = {items:[], current:null, generation:0, busy:false};
const stageNames = {planned:"Запланирован",in_progress:"В работе",review:"На проверке",changes_requested:"Нужны доработки",done:"Принят"};
function projectButton(label, fn, className="secondary") {
  const button=el("button",pt(label),className); button.type="button"; button.onclick=fn; return button;
}
function projectProposalButton(proposal) {
  return projectButton(proposal.project_id ? "Открыть проект →" : "Начать проект →", event => {
    if(proposal.project_id) { view("projects",{projectId:proposal.project_id}); return; }
    action(event.currentTarget,async()=>{const project=await api('/api/me/proposals/'+proposal.id+'/project','POST',{});view('projects',{projectId:project.id});});
  });
}
async function loadProjects(preferred) {
  const generation=++projects.generation;
  $("project-detail").hidden=true;
  SolvexI18n.set($("projects-status"),pt("Загружаем проекты…"));
  try {
    const data=await api('/api/me/projects');
    if(generation!==projects.generation || state.currentView!=='projects') return;
    projects.items=data.projects;renderProjectList();
    let remembered=null;try {remembered=Number(sessionStorage.getItem('solvex-project-'+state.user.id));}catch{}
    const id=preferred || projects.current?.id || remembered;
    if(id && data.projects.some(p=>p.id===id)) await openProject(id,generation);
    else {projects.current=null;$("project-detail").hidden=true;}
    SolvexI18n.set($("projects-status"),"");
  }catch(error){if(generation===projects.generation)SolvexI18n.set($("projects-status"),error.message);}
}
function renderProjectList() {
  const list=$("project-list");list.replaceChildren();
  if(!projects.items.length){const empty=el('div',null,'project-empty');empty.append(el('span','▦','project-empty-icon'),el('h2',pt('Здесь начинается совместная работа')),el('p',pt(state.user.role==='BUSINESS'?'Выберите команду в откликах и нажмите «Начать проект».':'Проект появится здесь, когда бизнес начнёт работу по вашему выбранному отклику.')));list.append(empty);return;}
  for(const project of projects.items){
    const card=projectButton('Открыть проект →',()=>openProject(project.id),'project-tile');card.replaceChildren();card.dataset.projectId=project.id;
    card.setAttribute('aria-pressed',String(projects.current?.id===project.id));
    card.append(el('span',pt(project.status==='completed'?'Завершён':'В работе'),'project-status'),el('strong',project.title),el('span',project.team_name),el('small',pt('Принято этапов: {0} / {1}',project.done,project.total)));
    if(project.review)card.append(el('small',pt('На проверке: {0}',project.review),'project-review-count'));
    list.append(card);
  }
}
async function openProject(id,existingGeneration) {
  const generation=existingGeneration ?? ++projects.generation;
  $("project-detail").hidden=true;
  try {
    const data=await api('/api/me/projects/'+id);
    if(generation!==projects.generation || state.currentView!=='projects')return;
    projects.current=data;history.replaceState(null,'','#projects/'+data.id);
    try{sessionStorage.setItem('solvex-project-'+state.user.id,String(data.id));}catch{}
    renderProjectList();renderProject();
  }catch(error){if(generation===projects.generation)message(error.message,true);}
}
function acceptProject(data){
  projects.current=data;projects.items=projects.items.map(p=>p.id===data.id?data:p);renderProjectList();renderProject();message(pt('Изменения сохранены'));
}
async function projectMutation(button,path,method,payload) {
  if(projects.busy)return;
  const current=projects.current, generation=projects.generation;projects.busy=true;
  await action(button,async()=>{
    const data=await api('/api/me/projects/'+current.id+path,method,{...payload,expected_revision:current.revision});
    if(generation===projects.generation && projects.current?.id===current.id)acceptProject(data);
  });projects.busy=false;
}
function renderProject() {
  const project=projects.current, target=$("project-detail");target.replaceChildren();target.hidden=false;
  const business=state.user.role==='BUSINESS', active=project.status==='active';
  const hero=el('div',null,'project-hero'), heading=el('div');heading.append(el('span',pt('Ваш общий маршрут'),'eyebrow'),el('h2',project.title),el('p',project.team_name));
  const progress=el('div',null,'project-progress'), percent=project.total?Math.round(project.done/project.total*100):0;
  progress.append(el('strong',percent+'%'),el('span',pt('Принято этапов: {0} / {1}',project.done,project.total)));hero.append(heading,progress);target.append(hero);
  const bar=el('progress');bar.max=100;bar.value=percent;SolvexI18n.attribute(bar,'aria-label',pt('Дорожная карта'));target.append(bar);
  const layout=el('div',null,'project-layout'), roadmap=el('div'), top=el('div',null,'roadmap-heading');top.append(el('h3',pt('Дорожная карта')));
  if(business&&active)top.append(projectButton('Добавить этап',()=>projectForm('add'), 'primary'));
  roadmap.append(top);
  if(!project.milestones.length){const empty=el('div',null,'project-empty');empty.append(el('h3',pt('Сначала задайте первый этап')),el('p',pt(business?'Опишите результат, который хотите получить. Срок можно добавить позже.':'Бизнес готовит дорожную карту. Обновите проект, чтобы увидеть новые этапы.')));roadmap.append(empty);}
  project.milestones.forEach((stage,index)=>roadmap.append(milestoneCard(stage,index,business,active)));
  if(business){const complete=projectButton(active?'Завершить проект':'Открыть снова',e=>projectMutation(e.currentTarget,'','PATCH',{status:active?'completed':'active'}));complete.id='project-complete';complete.disabled=active&&(!project.total||project.done!==project.total);roadmap.append(complete);if(complete.disabled)roadmap.append(el('p',pt('Завершение доступно после приёмки всех этапов.'),'hint'));}
  const aside=el('aside',null,'project-aside'), agreement=el('details');agreement.append(el('summary',pt('Договорённости на старте')),el('p',pt('Снимок задачи и отклика на момент создания проекта.'),'hint'));
  for(const key of ['need','expected_result','success_criteria','constraints'])if(project.snapshot.card[key])agreement.append(el('h4',FIELDS[key]),el('p',project.snapshot.card[key]));
  agreement.append(el('h4',pt('Предложение')),el('p',project.snapshot.proposal.idea),el('p',project.snapshot.proposal.plan),el('p',pt('Предложенный срок: {0} дн.',project.snapshot.proposal.duration_days)));aside.append(agreement);
  const members=el('details');members.append(el('summary',pt('Участники')),el('h4',pt('Бизнес')),organizationCard(project.business,true),el('h4',pt('Команда')),organizationCard(project.team,true));aside.append(members);
  aside.append(el('p',pt(project.points_awarded?'Баллы за этот отклик уже начислены.':'При первой приёмке — +10 команде за отклик. Повторно баллы не начисляются.'),'hint'));
  layout.append(roadmap,aside);target.append(layout);
  const history=el('section',null,'project-history');history.append(el('h3',pt('Журнал работы')),el('p',pt('История сдач и замечаний сохраняется здесь.'),'hint'));
  const kinds={created:'Проект создан',milestone_added:'Этап добавлен',milestone_edited:'Этап изменён',start:'Этап начат',submit:'Результат отправлен',approve:'Этап принят',revise:'Запрошены доработки',completed:'Проект завершён',active:'Проект открыт снова'};
  const events=el('div');for(const entry of project.events){const item=el('article',null,'project-event');item.append(el('span',pt(entry.actor_role==='BUSINESS'?'Бизнес':'Команда'),'eyebrow'),el('strong',pt(kinds[entry.kind])),el('small',new Date(entry.created_at).toLocaleString(SolvexI18n.locale)));
    if(entry.content.title)item.append(el('p',entry.content.title));if(entry.content.note)item.append(el('p',entry.content.note));if(entry.content.description)item.append(el('p',entry.content.description));if(entry.content.due_date)item.append(el('small',entry.content.due_date));if(entry.content.result_url)item.append(resultLink(entry.content.result_url));events.append(item);}
  if(project.events.length>6){const more=el('details');more.append(el('summary',pt('Показать всю историю')),events);history.append(more);}else history.append(events);target.append(history);
}
function resultLink(url){const link=el('a',pt('Открыть результат ↗'));link.href=url;link.target='_blank';link.rel='noopener noreferrer';return link;}
function milestoneCard(stage,index,business,active){
  const card=el('article',null,'roadmap-stage stage-'+stage.status);card.dataset.milestoneId=stage.id;
  const heading=el('div',null,'stage-heading');heading.append(el('span',String(index+1).padStart(2,'0'),'stage-number'),el('h4',stage.title),el('span',pt(stageNames[stage.status]),'stage-status'));card.append(heading);
  const deadline=el('p',stage.due_date?new Date(stage.due_date+'T12:00:00').toLocaleDateString(SolvexI18n.locale):pt('Без срока'),'stage-deadline');
  if(stage.due_date&&stage.status!=='done'&&new Date(stage.due_date+'T23:59:59')<new Date())deadline.append(el('span',pt('Срок прошёл'),'stage-overdue'));
  card.append(deadline,el('span',pt('Ожидаемый результат этапа'),'eyebrow'),el('p',stage.description,'stage-copy'));
  if(stage.result_note){const result=el('div',null,'stage-result');result.append(el('h5',pt('Результат команды')),el('p',stage.result_note));if(stage.result_url)result.append(resultLink(stage.result_url));card.append(result);}
  if(stage.feedback){const feedback=el('div',null,'stage-feedback');feedback.append(el('h5',pt('Замечания бизнеса')),el('p',stage.feedback));card.append(feedback);}
  const actions=el('div',null,'actions');
  if(active){if(business&&stage.status==='planned')actions.append(projectButton('Редактировать этап',()=>projectForm('edit',stage),'text-button'));
    if(!business&&['planned','changes_requested'].includes(stage.status))actions.append(projectButton('Взять в работу',e=>projectMutation(e.currentTarget,'/milestones/'+stage.id+'/action','POST',{action:'start'})));
    if(!business&&['planned','in_progress','changes_requested'].includes(stage.status))actions.append(projectButton('Сдать результат',()=>projectForm('submit',stage),'primary'));
    if(business&&stage.status==='review'){actions.append(projectButton('Принять результат',e=>projectMutation(e.currentTarget,'/milestones/'+stage.id+'/action','POST',{action:'approve'}),'primary'),projectButton('Вернуть на доработку',()=>projectForm('revise',stage)));}}
  if(actions.childElementCount)card.append(actions);return card;
}
function projectForm(mode,stage=null){
  const project=projects.current, revision=project.revision, generation=projects.generation;
  const dialog=el('dialog',null,'project-dialog'), form=el('form');dialog.setAttribute('aria-labelledby','project-form-title');
  const title=el('h2',pt({add:'Добавить этап',edit:'Редактировать этап',submit:'Сдать результат',revise:'Вернуть на доработку'}[mode]));title.id='project-form-title';form.append(title);const inputs={};
  function field(key,label,type,value='',required=true,max=3000){const input=el(type==='textarea'?'textarea':'input'),lab=el('label',pt(label));input.id='project-input-'+key;lab.htmlFor=input.id;input.value=value;input.required=required;if(type!=='textarea')input.type=type;else input.rows=5;input.maxLength=max;inputs[key]=input;form.append(lab,input);return input;}
  if(mode==='add'||mode==='edit'){field('title','Название этапа','text',stage?.title||'',true,160).minLength=3;field('description','Что должно быть готово','textarea',stage?.description||'',true,2000).minLength=3;field('due_date','Срок (необязательно)','date',stage?.due_date||'',false);}
  else {field('note',mode==='submit'?'Описание результата':'Что нужно доработать','textarea',mode==='submit'?stage?.result_note||'':'').minLength=mode==='submit'?10:3;if(mode==='submit')field('result_url','Ссылка на результат (необязательно)','url',stage?.result_url||'',false,500);}
  const status=el('p',null,'project-form-status');status.setAttribute('role','alert');const controls=el('div',null,'actions'),save=el('button',pt(mode==='submit'?'Отправить результат':mode==='revise'?'Отправить замечания':'Сохранить этап'),'primary');save.type='submit';let saving=false;
  function close(){if(saving)return;if(state.projectDirty&&!confirm(pt('Изменения формы не сохранены. Закрыть её?')))return;state.projectDirty=false;dialog.close();}
  controls.append(save,projectButton('Отмена',close));form.append(status,controls);dialog.append(form);document.body.append(dialog);dialog.showModal();
  form.addEventListener('input',()=>{state.projectDirty=true;});dialog.addEventListener('cancel',event=>{event.preventDefault();close();});dialog.addEventListener('close',()=>{state.projectDirty=false;dialog.remove();});
  form.addEventListener('submit',async event=>{event.preventDefault();if(saving)return;saving=true;const all=[...form.querySelectorAll('input,textarea,button')];all.forEach(n=>n.disabled=true);SolvexI18n.set(status,pt('Сохраняем…'));
    const payload={expected_revision:revision};Object.entries(inputs).forEach(([key,input])=>payload[key]=key==='due_date'?(input.value||null):input.value.trim());
    let path='/milestones',method='POST';if(mode==='edit'){path+='/'+stage.id;method='PUT';}if(mode==='submit'||mode==='revise'){path+='/'+stage.id+'/action';payload.action=mode;}
    try{const data=await api('/api/me/projects/'+project.id+path,method,payload);state.projectDirty=false;dialog.close();if(generation===projects.generation)acceptProject(data);}
    catch(error){SolvexI18n.set(status,error.status===409?pt('Проект изменился. Закройте форму и обновите проект. Перед этим скопируйте свой текст.'):error.message);}
    finally{saving=false;all.forEach(n=>n.disabled=false);}
  });
}
$("projects-refresh").onclick=()=>loadProjects(projects.current?.id);
