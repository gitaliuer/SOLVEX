/* Isolated agent regressions; all model and API responses below are fixtures. */
(async () => {
  const output = document.getElementById("results"), frame = document.getElementById("preview");
  const [html, app, agent] = await Promise.all(["workspace.html", "app.js", "agent.js"].map(async file => (await fetch("/static/" + file, {cache:"no-store"})).text()));
  frame.srcdoc = html.replace(/<script[^>]+src="[^"]+"[^>]*><\/script>/g, "");
  await new Promise(resolve => frame.addEventListener("load", resolve, {once:true}));
  const win = frame.contentWindow, doc = win.document, byId = id => doc.getElementById(id), requests = [];
  win.history.replaceState = () => {};
  Object.defineProperty(win, "sessionStorage", {value:{getItem:()=>null,setItem:()=>{},removeItem:()=>{}}});
  win.SolvexAuth = {getSession:async()=>({user:{id:999999,email:"fixture@example.org",role:"BUSINESS"},csrf_token:"fixture"}),open:()=>{}};
  const fields = ["title","context","need","users","data","constraints","expected_result","success_criteria","contact","interaction_format"];
  let failAI = true, failSave = false;
  const task = {id:91,revision:0,topic:"Без темы",card:Object.fromEntries(fields.map(key=>[key,""])),confirmed_fields:[],status:"draft",score:0,level:"draft",score_breakdown:{},missing_fields:fields.slice(1)};
  const conversation = {task,messages:[],run:null};
  win.fetch = async (url, options={}) => {
    const method = options.method || "GET", payload = options.body ? JSON.parse(options.body) : null;
    requests.push({url,method});
    await new Promise(resolve=>setTimeout(resolve,80));
    let data, status=200;
    if (url==="/api/me/agent") data=conversation;
    else if (url==="/api/me/agent/91/messages") {
      if (!conversation.run || conversation.run.request_id!==payload.request_id) conversation.messages.push({id:conversation.messages.length+1,role:"user",text:payload.text,created_at:new Date().toISOString()});
      conversation.run={request_id:payload.request_id,status:failAI?"failed":"completed",error:failAI?"Тестовая ошибка AI":""};
      if (!failAI) {
        conversation.messages.push({id:conversation.messages.length+1,role:"assistant",text:"Ответ AI.\n1. Какие данные?\n2. Для кого?\n3. Как проверим?",created_at:new Date().toISOString()});
        task.card.context="Контекст из сообщения"; task.card.title="Тестовая задача"; task.revision++;
      }
      data=conversation;
    } else if (url==="/api/me/agent/91") data=conversation;
    else if (url==="/api/me/tasks/91" && method==="PUT") {
      if(failSave){status=503;data={error:{message:"Тестовая ошибка сохранения"}};}
      else {Object.assign(task,payload);task.revision++;
        task.score_breakdown={context:payload.confirmed_fields.includes("context")&&payload.card.context?10:0};
        task.score=task.score_breakdown.context;data=task;}
    } else if(url==="/api/me/tasks") data={tasks:task.revision?[task]:[]};
    else if(url.startsWith("/api/catalog/tasks")) data={tasks:[]};
    else throw new Error("Unexpected fixture route: "+url);
    return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json"}});
  };
  const script=doc.createElement("script");script.textContent=app+"\n"+agent;doc.body.append(script);
  const lines=[];
  function check(value,label){lines.push((value?"PASS ":"FAIL ")+label);output.textContent=lines.join("\n");}
  const delay=()=>new Promise(resolve=>setTimeout(resolve,350));
  function edit(id,text){byId(id).value=text;byId(id).dispatchEvent(new win.Event("input"));}
  await delay();
  check(!doc.querySelector(".step-track")&&byId("chat-input"),"Основной сценарий — чат без старого мастера");
  edit("chat-input","В магазине много списаний.");byId("send-message").click();
  check(byId("send-message").disabled&&!byId("agent-activity").hidden,"Видимое ожидание и защита от двойной отправки");
  await delay();
  check(conversation.messages.length===1&&!byId("agent-error").hidden&&doc.querySelectorAll(".assistant").length===0,"Ошибка сохраняет сообщение и не подменяется ответом AI");
  failAI=false;byId("retry-message").click();await delay();
  check(conversation.messages.length===2&&doc.querySelectorAll(".chat-message.user").length===1,"Повтор не дублирует сообщение");
  check(byId("field-context").value==="Контекст из сообщения"&&!byId("confirm-context").checked&&byId("score").textContent==="0","AI обновляет карточку без подтверждений и баллов");
  byId("confirm-context").click();byId("save").click();await delay();
  check(byId("score").textContent==="10","Подтверждение и сохранение пересчитывают рейтинг");
  edit("field-context","Ручная правка");
  check(!byId("confirm-context").checked&&!byId("unsaved").hidden,"Изменение факта снимает подтверждение");
  failSave=true;byId("save").click();await delay();
  check(byId("field-context").value==="Ручная правка"&&!byId("save").disabled,"Ошибка сохранения сохраняет текст и возвращает управление");
  doc.querySelector('[data-view="catalog"]').click();await delay();doc.querySelector('[data-view="create"]').click();await delay();
  check(byId("field-context").value==="Ручная правка","Переходы по разделам сохраняют ручной ввод");
  win.confirm=()=>false;byId("new-task").click();
  check(byId("field-context").value==="Ручная правка","Отмена новой задачи защищает несохранённые изменения");
  failSave=false;byId("save").click();await delay();
  check(requests.filter(r=>r.url==="/api/me/agent"&&r.method==="POST").length===1&&task.id===91,"Повторные сохранения используют прежнюю задачу");
  for(const width of [390,375]){frame.style.width=width+"px";await delay();check(doc.documentElement.scrollWidth<=doc.documentElement.clientWidth,"Панели без горизонтальной прокрутки: "+width);}
  frame.style.width="100%";
  const history = Array.from({length:24},(_,i)=>({id:1000+i,role:i%2?"assistant":"user",text:"Длинное сообщение для проверки чтения истории. ".repeat(6),created_at:new Date().toISOString()}));
  win.acceptSnapshot({...conversation,messages:history});await delay();
  byId("chat-scroll").scrollTop=0;
  win.acceptSnapshot({...conversation,messages:[...history,{id:1030,role:"assistant",text:"Новый ответ",created_at:new Date().toISOString()}]});await delay();
  check(byId("chat-scroll").scrollTop===0&&!byId("chat-jump").hidden,"Новый ответ не прерывает чтение истории");
  byId("chat-jump").click();await delay();
  check(byId("chat-jump").hidden&&byId("chat-scroll").scrollTop>0,"Кнопка возвращает к новым сообщениям");
  output.textContent+="\nЗавершено. Только синтетические ответы.";
})().catch(error=>{document.getElementById("results").textContent+="\nERROR "+error.message;});
