"use strict";
Object.assign(window.SolvexTranslations, {
  "Внутри SOLVEX":"Inside SOLVEX", "Не нужно знать ответ.":"You don't need the answer.", "Начните с вопроса.":"Start with a question.",
  "Агент помогает разобраться в проблеме, проверить основания и подготовить задачу для команды.":"Your agent helps clarify the problem, examine evidence and prepare a challenge for a team.",
  "Этапы примера":"Example stages", "Диалог":"Conversation", "Основания":"Evidence", "Следующий шаг":"Next step", "Иллюстрация сценария":"Illustrative scenario",
  "Собираем по ходу разговора":"Taking shape as you talk", "Вы подтверждаете данные и выбираете команду.":"You confirm the information and choose the team.",
  "Следующий шаг →":"Next step →", "С начала ↺":"Start again ↺", "Возможности для бизнеса и команд":"For businesses and teams",
  "От «что не так»":"From ‘what's wrong’", "к понятной задаче.":"to a clear challenge.", "Ваш опыт.":"Your expertise.", "Реальная потребность.":"A real business need.",
  "Добавьте фото, обсудите детали с агентом и получите отклики. Контекст останется в одном месте.":"Add photos, discuss details with your agent and receive proposals. Keep the context in one place.",
  "Найдите подходящую задачу, предложите подход и начните разговор с бизнесом прямо на платформе.":"Find a challenge, propose an approach and talk directly to the business on the platform.",
  "Обсудить свою задачу ↗":"Discuss your challenge ↗", "Найти свою задачу ↗":"Find your challenge ↗",
  "Один агент. То же качество.":"One agent. The same quality.", "Начните бесплатно.":"Start for free.", "Продолжайте, когда нужно больше.":"Keep going when you need more.",
  "Лимит определяет количество запросов. Модель и качество ответов одинаковы.":"Limits apply to request counts. The model and response quality stay the same.", "Загружаем тарифы…":"Loading plans…",
  "В магазине растут списания, но причина пока непонятна.":"Write-offs are increasing at our store, but we don't know why.",
  "Какие товары списываются чаще? Есть ли данные по остаткам и срокам годности?":"Which products are written off most often? Do you have inventory and expiry-date records?",
  "Сократить списания":"Reduce write-offs", "Проблема: растущие списания":"Problem: increasing write-offs", "Данные: нужно уточнить":"Data: needs clarification", "Причина: пока неизвестна":"Cause: not yet known",
  "Есть еженедельные отчёты. Что ещё стоит проверить?":"We have weekly reports. What else should we check?", "Можно сопоставить практики учёта и планирования. Сначала уточним: отчёты охватывают все группы товаров?":"We can compare inventory and planning practices. First, do the reports cover every product category?",
  "Разделяем данные и предположения":"Separate data from assumptions", "Данные бизнеса: еженедельные отчёты":"Business data: weekly reports", "Гипотеза: проверить полноту учёта":"Hypothesis: check record coverage", "Источники: нужен отдельный поиск":"Evidence: a separate search is needed",
  "Хочу найти команду, которая поможет разобраться.":"I'd like to find a team to help investigate.", "Подготовим карточку: проблема, доступные данные и ожидаемый результат. Вы проверите её перед публикацией.":"Let's prepare the challenge: problem, available data and expected outcome. You review it before publishing.",
  "Задача готовится к публикации":"Preparing the challenge", "Проверить и подтвердить карточку":"Review and confirm the challenge", "Добавить фото и получить отклики":"Add photos and receive proposals", "Обсудить подход с командой":"Discuss the approach with a team"
});
document.addEventListener('DOMContentLoaded',()=>{
  const stages=[
    ['В магазине растут списания, но причина пока непонятна.','Какие товары списываются чаще? Есть ли данные по остаткам и срокам годности?','Сократить списания',['Проблема: растущие списания','Данные: нужно уточнить','Причина: пока неизвестна']],
    ['Есть еженедельные отчёты. Что ещё стоит проверить?','Можно сопоставить практики учёта и планирования. Сначала уточним: отчёты охватывают все группы товаров?','Разделяем данные и предположения',['Данные бизнеса: еженедельные отчёты','Гипотеза: проверить полноту учёта','Источники: нужен отдельный поиск']],
    ['Хочу найти команду, которая поможет разобраться.','Подготовим карточку: проблема, доступные данные и ожидаемый результат. Вы проверите её перед публикацией.','Задача готовится к публикации',['Проверить и подтвердить карточку','Добавить фото и получить отклики','Обсудить подход с командой']]
  ];let active=0;
  const set=(node,text)=>SolvexI18n.set(node,SolvexI18n.text(text));
  function show(index){active=index;const data=stages[index],dialogue=document.getElementById('story-dialogue'),body=document.getElementById('story-result-body');dialogue.replaceChildren();body.replaceChildren();
    data.slice(0,2).forEach((value,i)=>{const p=document.createElement('p');p.className='story-bubble '+(i?'agent':'user')+' story-enter';set(p,value);dialogue.append(p);});
    set(document.getElementById('story-result-title'),data[2]);data[3].forEach((value,i)=>{const row=document.createElement('div');row.className='story-fact'+(index<2&&i>0?' missing':'');const icon=document.createElement('span');icon.textContent=index<2&&i>0?'○':'✓';icon.setAttribute('aria-hidden','true');const label=document.createElement('span');set(label,value);row.append(icon,label);body.append(row);});
    document.querySelectorAll('[data-story]').forEach(b=>b.setAttribute('aria-pressed',String(Number(b.dataset.story)===index)));set(document.getElementById('story-next'),index===2?'С начала ↺':'Следующий шаг →');
  }
  document.querySelectorAll('[data-story]').forEach(b=>b.addEventListener('click',()=>show(Number(b.dataset.story))));document.getElementById('story-next').addEventListener('click',()=>show((active+1)%3));show(0);
});
