"use strict";

// Uploaded media belongs to the task; personal conversations never enter the AI chat.
let mediaTaskId = undefined, mediaGeneration = 0, mediaRenderImages = () => {}, mediaSyncLocks = () => {};
const dm = {id:null, drafts:new Map(), retries:new Map(), items:[], seen:new Set(), last:0, generation:0, loading:null, sending:false, listGeneration:0};
const tx = source => SolvexI18n.text(source);
const mediaMount = el('details',null,'task-media'); mediaMount.id='task-media'; document.querySelector('.preview-scroll').append(mediaMount);
function mediaPhoto(photo, title, className = '') {
  const img = el('img', null, className); img.src = photo.url; img.alt = title || String(tx('Фото задачи')); img.loading = 'lazy'; return img;
}
function coverForTask(task) {
  if (task.images?.length) return mediaPhoto(task.images[0], task.card.title, 'task-cover');
  const cover = el('div', null, 'task-cover task-cover-empty'); cover.setAttribute('aria-hidden','true');
  cover.append(el('span','▧'), el('small', task.topic)); return cover;
}
function taskGallery(task) {
  const gallery = el('div', null, 'task-gallery');
  if (!task.images?.length) return gallery;
  const main = mediaPhoto(task.images[0], task.card.title, 'detail-cover'); main.loading = 'eager';
  const opener = el('button', null, 'photo-open'); opener.type = 'button';
  SolvexI18n.attribute(opener,'aria-label',tx('Открыть фото')); opener.append(main);
  opener.onclick = () => {
    const dialog = el('dialog', null, 'photo-dialog'), close = el('button',tx('Закрыть'),'secondary'); close.type = 'button';
    const full = el('img'); full.src = main.src; full.alt = main.alt; dialog.append(close,full); document.body.append(dialog);
    close.onclick = () => dialog.close(); dialog.addEventListener('close',() => { dialog.remove(); opener.focus(); }); dialog.showModal(); close.focus();
  };
  gallery.append(opener);
  if (task.images.length > 1) {
    const thumbs = el('div',null,'photo-thumbnails');
    task.images.forEach((photo,index) => {
      const button = el('button'); button.type='button'; button.setAttribute('aria-pressed',String(index===0));
      SolvexI18n.attribute(button,'aria-label',SolvexI18n.text('Фото {0}',index+1)); button.append(mediaPhoto(photo,''));
      button.onclick=()=>{ main.src=photo.url; thumbs.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b===button))); }; thumbs.append(button);
    }); gallery.append(thumbs);
  } return gallery;
}
function setTaskMedia(task) {
  const id = task?.id || null;
  if (mediaTaskId === id) return;
  mediaTaskId = id; const generation = ++mediaGeneration; state.contactDirty = false;
  const root = $('task-media'); root.replaceChildren();
  const summary = el('summary',tx('Фото и связь с бизнесом'));
  const content = el('div',null,'task-media-content'), grid = el('div',null,'media-edit-grid');
  const status = el('p','', 'hint'); status.setAttribute('role','status');
  const file = el('input'); file.type='file'; file.accept='image/jpeg,image/png,image/webp'; file.multiple=true; file.id='task-photo-file'; file.hidden=true;
  const label = el('button',tx('＋ Добавить фото'),'secondary photo-label'); label.type='button'; label.onclick=()=>file.click();
  const uploadHint = el('p',tx('До 5 фото · JPEG, PNG, WebP · до 3 МБ каждое. Обложку можно изменить.'),'hint');
  const valid = () => generation === mediaGeneration;
  function renderImages(images) {
    grid.replaceChildren();
    for (const photo of images) {
      const tile=el('div',null,'media-edit-tile'), cover=el('button',photo.is_cover?tx('Обложка'):tx('На обложку'),'text-button'), remove=el('button',tx('Удалить фото'),'text-button');
      cover.type=remove.type='button'; cover.disabled=photo.is_cover; cover.dataset.cover=String(photo.is_cover);
      const change=async(method,button)=>action(button,async()=>{
        const result=await api(`/api/me/tasks/${mediaTaskId}/images/${photo.id}`,method);
        if(valid()) {agent.task.images=result.images; renderImages(result.images); SolvexI18n.set(status,tx('✓ Фото сохранены'));}
      });
      cover.onclick=()=>change('PATCH',cover); remove.onclick=()=>change('DELETE',remove);
      tile.append(mediaPhoto(photo,''),cover,remove); grid.append(tile);
    }
    file.disabled=label.disabled=images.length>=5;
    mediaSyncLocks();
  }
  mediaRenderImages=renderImages;
  renderImages(task?.images || []);
  file.addEventListener('change',async()=>{
    const files=Array.from(file.files || []); if(!files.length)return;
    if(files.some(f=>f.size>3*1024*1024 || !['image/jpeg','image/png','image/webp'].includes(f.type))) {SolvexI18n.set(status,tx('Выберите фото JPEG, PNG или WebP до 3 МБ.')); file.value='';return;}
    if(grid.children.length+files.length>5){SolvexI18n.set(status,tx('Можно прикрепить до пяти фотографий'));file.value='';return;}
    if(state.busy)return;
    state.busy=true; file.disabled=true; lockAgent();
    try {
      await ensureTask(); const targetId=state.taskId;
      for(const photo of files) {
        const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
        try {
          const response=await fetch(`/api/me/tasks/${targetId}/images`,{method:'POST',credentials:'same-origin',headers:{'X-CSRF-Token':state.csrf,'Content-Type':photo.type},body:photo,signal:controller.signal});
          const data=await response.json(); if(!response.ok)throw new Error(SolvexI18n.failure(data.error));
          if(state.taskId===targetId) { agent.task.images=data.images; mediaRenderImages(data.images); $('task-media').open=true; }
        } finally {clearTimeout(timer);}
      }
      message(tx(agent.task?.status==='published'?'✓ Фото сохранены и доступны в каталоге.':'✓ Фото сохранены. До публикации они видны только вам.'));
    } catch(error){message(error.name==='AbortError'?tx('Время ожидания истекло. Проверьте фото перед повтором.'):error.message,true);}
    finally{state.busy=false;file.value='';lockAgent();if(agent.task)mediaRenderImages(agent.task.images||[]);}
  });
  content.append(uploadHint,grid,label,file,status);
  const form=el('form',null,'task-contact-form'), phoneLabel=el('label',tx('Номер WhatsApp (необязательно)')), phone=el('input'); form.hidden=!id;
  phone.type='tel';phone.id='task-whatsapp';phone.maxLength=40;phone.autocomplete='tel';phone.placeholder='+7 700 000 00 00';phoneLabel.htmlFor=phone.id;
  const consent=el('label',null,'contact-consent'), enabled=el('input');enabled.type='checkbox';
  consent.append(enabled,el('span',tx('Показывать WhatsApp в опубликованной задаче')));
  const save=el('button',tx('Сохранить контакт'),'secondary');save.type='submit';
  form.append(phoneLabel,phone,consent,el('p',tx('Номер станет доступен посетителям каталога. Переписка на сайте работает и без WhatsApp.'),'hint'),save);
  form.oninput=()=>{state.contactDirty=true;};
  form.onsubmit=event=>{event.preventDefault();action(save,async()=>{
    const payload={phone:phone.value,enabled:enabled.checked}; await ensureTask(); const targetId=state.taskId;
    const saved=await api(`/api/me/tasks/${targetId}/contact`,'PUT',payload);
    if(state.taskId===targetId){state.contactDirty=false; phone.value=saved.phone; enabled.checked=saved.enabled; message(tx('✓ Контакт сохранён'));}
  });};
  content.append(form); root.append(summary,content);
  let contactLoading=Boolean(id);
  mediaSyncLocks=()=>{
    if(!valid())return;
    const busy=state.busy||agent.sending||agent.run?.status==='pending';
    grid.querySelectorAll('button').forEach(button=>{button.disabled=Boolean(busy)||button.dataset.cover==='true';});
    file.disabled=label.disabled=Boolean(busy)||grid.children.length>=5;
    phone.disabled=enabled.disabled=save.disabled=Boolean(busy)||contactLoading;
  };
  mediaSyncLocks();
  if(id){
    const retry=el('button',tx('Повторить'),'secondary');retry.type='button';retry.hidden=true;form.prepend(retry);
    async function loadContact(){
      contactLoading=true;mediaSyncLocks();retry.hidden=true;
      try{const data=await api(`/api/me/tasks/${id}/contact`);if(valid()){phone.value=data.phone;enabled.checked=data.enabled;contactLoading=false;mediaSyncLocks();}}
      catch(error){if(valid()){SolvexI18n.set(status,error.message);retry.hidden=false;}}
    }
    retry.onclick=loadContact;loadContact();
  }
}

function conversationButton(taskId, proposalId = null) {
  const button=el('button',tx('Написать'),'secondary');button.type='button';
  button.onclick=()=>action(button,async()=>{
    const item=await api(proposalId?`/api/me/proposals/${proposalId}/conversation`:`/api/catalog/tasks/${taskId}/conversation`,'POST',{});
    view('messages',{conversationId:item.id});
  });return button;
}
function contactActions(task) {
  const actions=el('div',null,'task-contact-actions');
  if(state.user.role==='TEAM') {
    const respond=el('button',tx('Откликнуться'),'primary');respond.type='button';
    respond.onclick=()=>{const target=$('proposal-section');if(target)reveal(target);}; actions.append(respond,conversationButton(task.id));
  }
  if(task.whatsapp_url && /^https:\/\/wa\.me\/[1-9][0-9]{7,14}$/.test(task.whatsapp_url)) {
    const link=el('a','WhatsApp ↗','button whatsapp-link');link.href=task.whatsapp_url;link.target='_blank';link.rel='noopener noreferrer';actions.append(link);
  }return actions;
}
function hasMessageDrafts(){return [...dm.drafts.values()].some(value=>value.trim());}
function renderInbox() {
  const list=$('conversation-list');list.replaceChildren();
  if(!dm.items.length)list.append(el('p',tx('Здесь появятся диалоги по задачам. Начните с кнопки «Написать» в задаче или отклике.'),'empty-state'));
  for(const item of dm.items){
    const button=el('button',null,'conversation-item');button.type='button';button.classList.toggle('active',item.id===dm.id);button.setAttribute('aria-pressed',String(item.id===dm.id));
    button.append(el('strong',item.peer_name||tx(item.peer_role==='TEAM'?'Команда':'Бизнес')),el('span',item.task_title||tx('Без названия')),el('small',item.last_text||tx('Начните разговор')));
    if(item.unread)button.append(el('b',String(item.unread),'unread-count'));button.onclick=()=>selectConversation(item.id);list.append(button);
  }
  const count=dm.items.reduce((sum,item)=>sum+item.unread,0);SolvexI18n.set($('messages-badge'),count?String(count):'');
}
async function refreshInbox(quiet=false){
  const generation=++dm.listGeneration;
  try{const data=await api('/api/me/conversations');if(generation!==dm.listGeneration)return;dm.items=data.conversations;renderInbox();}
  catch(error){if(!quiet)message(error.message,true);}
}
async function loadConversations(preferred){
  await refreshInbox(); if(state.currentView!=='messages')return;
  const next=preferred || dm.id || dm.items[0]?.id;
  if(next) {if(next===dm.id)await fetchDirectMessages();else await selectConversation(next);}
}
async function selectConversation(id){
  dm.id=id;dm.generation++;dm.last=0;dm.seen.clear();$('direct-log').replaceChildren();$('conversation-panel').hidden=false;$('conversation-empty').hidden=true;
  $('direct-input').value=dm.drafts.get(id)||'';SolvexI18n.set($('direct-status'),tx('Загружаем переписку…'));renderInbox();await fetchDirectMessages();
}
function appendDirectMessage(item){
  if(dm.seen.has(item.id))return;dm.seen.add(item.id);dm.last=Math.max(dm.last,item.id);
  const bubble=el('article',null,'direct-message'+(item.mine?' mine':'')),time=el('time');
  time.dateTime=item.created_at;time.textContent=new Intl.DateTimeFormat(SolvexI18n.locale,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(item.created_at));
  bubble.append(el('span',item.mine?tx('Вы'):tx('Собеседник'),'message-author'),el('p',item.text),time);$('direct-log').append(bubble);
}
async function fetchDirectMessages(){
  const id=dm.id,generation=dm.generation;if(!id || dm.loading===generation)return;dm.loading=generation;
  const valid=()=>id===dm.id&&generation===dm.generation;
  const log=$('direct-log'),nearBottom=log.scrollHeight-log.scrollTop-log.clientHeight<100,wasEmpty=!dm.last;
  try{
    let more=true;
    while(more && valid()){
      const data=await api(`/api/me/conversations/${id}/messages?after_id=${dm.last}`);if(!valid())return;
      SolvexI18n.set($('conversation-title'),data.conversation.peer_name||tx(data.conversation.peer_role==='TEAM'?'Команда':'Бизнес'));
      SolvexI18n.set($('conversation-task'),data.conversation.task_title||tx('Без названия'));
      $('conversation-task').onclick=()=>{if(state.user.role==='BUSINESS')openSavedTask(data.conversation.task_id).catch(e=>message(e.message,true));else{view('catalog');openConversationTask(data.conversation.task_id);}};
      for(const item of data.messages)appendDirectMessage(item);more=data.has_more;
    }
    if(valid()){
      SolvexI18n.set($('direct-status'),dm.last?'':tx('Начните разговор. Сообщения видны только вам и собеседнику.'));
      if(nearBottom||wasEmpty)log.scrollTop=log.scrollHeight;
      if(dm.last && !document.hidden && state.currentView==='messages' && (nearBottom||wasEmpty))await api(`/api/me/conversations/${id}/read`,'POST',{through_id:dm.last});
    }
  }catch(error){if(valid())SolvexI18n.set($('direct-status'),error.message);}
  finally{if(dm.loading===generation)dm.loading=null;}
}
async function openConversationTask(id){await loadTasks();if(state.currentView==='catalog')await openTask(id);}
$('direct-input').oninput=()=>dm.drafts.set(dm.id,$('direct-input').value);
$('direct-form').onsubmit=async event=>{
  event.preventDefault();if(dm.sending||!dm.id)return;
  const id=dm.id,text=$('direct-input').value.trim();if(!text)return;
  let pending=dm.retries.get(id);if(!pending||pending.text!==text){pending={text,request_id:crypto.randomUUID()};dm.retries.set(id,pending);}
  dm.sending=true;$('direct-send').disabled=true;SolvexI18n.set($('direct-status'),tx('Отправляем…'));
  try{
    await api(`/api/me/conversations/${id}/messages`,'POST',pending);dm.retries.delete(id);
    if((dm.drafts.get(id)||'').trim()===text){dm.drafts.delete(id);if(dm.id===id)$('direct-input').value='';}
    if(dm.id===id){await fetchDirectMessages();$('direct-log').scrollTop=$('direct-log').scrollHeight;}
    await refreshInbox(true);
  }catch(error){if(dm.id===id)SolvexI18n.set($('direct-status'),error.message);}
  finally{dm.sending=false;$('direct-send').disabled=false;}
};
$('direct-input').onkeydown=event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();$('direct-form').requestSubmit();}};
$('messages-refresh').onclick=()=>loadConversations();
setInterval(()=>{if(!state.user||document.hidden)return;refreshInbox(true);if(state.currentView==='messages')fetchDirectMessages();},12000);
window.addEventListener('solvex:language',()=>{renderInbox();document.querySelectorAll('#direct-log time').forEach(node=>{node.textContent=new Intl.DateTimeFormat(SolvexI18n.locale,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(node.dateTime));});});
