"use strict";
Object.assign(window.SolvexTranslations, {
  "Тариф и лимиты":"Plan and usage", "Больше пространства для идей.":"More room for your ideas.", "Тот же агент. Больше сообщений и исследований.":"The same agent. More messages and research.",
  "Бесплатно":"Free", "в месяц":"per month", "{0} AI-запросов в день":"{0} AI requests per day", "Исследований в день: {0}":"Research runs per day: {0}",
  "Начать бесплатно":"Start for free", "Ваш тариф":"Your plan", "Оплата скоро":"Payments coming soon", "Приём оплаты ещё не подключён.":"Payments are not connected yet.",
  "Модель и качество ответов одинаковы на обоих тарифах.":"The model and response quality are the same on both plans.",
  "AI-запросы сегодня":"AI requests today", "Исследования сегодня":"Research today", "Осталось {0} из {1}":"{0} of {1} remaining", "В обработке: {0}":"In progress: {0}",
  "Следующее обновление лимита: {0}":"Allowance resets: {0}", "Доступ Plus до {0}":"Plus access until {0}",
  "Лимит на сегодня использован":"Today's allowance is used up", "Осталось сегодня: {0} / {1}":"Remaining today: {0} / {1}",
  "Тарифы →":"View plans →", "AI-запросы":"AI requests", "Как считаются запросы":"How requests are counted",
  "Лимит общий для всех задач. Новое сообщение агенту, отдельный AI-разбор отклика или генерация карточки расходуют один AI-запрос. Один новый поиск Research — одно исследование.":"Allowances are shared across all challenges. A new agent message, a separate AI proposal review or card generation uses one AI request. A new Research search uses one research run.",
  "Сбой не расходует лимит. Чтение сохранённых ответов и повторное открытие результатов бесплатны. Личные сообщения людям, фото и работа с карточкой не ограничены тарифом AI.":"Failed requests do not use your allowance. Reading saved answers and reopening results are free. Human messages, photos and manual challenge editing are not limited by your AI plan.",
  "Сброс каждый день в 00:00 по времени Казахстана (UTC+05:00). Неиспользованные запросы не переносятся.":"Resets every day at midnight Kazakhstan time (UTC+05:00). Unused requests do not roll over.",
  "Не удалось загрузить лимиты. Повторить":"Could not load usage. Retry", "Не удалось загрузить тарифы. Обновите страницу.":"Could not load plans. Refresh the page.",
  "Разборы откликов также расходуют AI-запросы.":"Proposal reviews also use AI requests."
});
window.SolvexPlans={render(container,data,current){
  const make=(tag,text,cls)=>{const node=document.createElement(tag);if(text!==undefined)SolvexI18n.set(node,text);if(cls)node.className=cls;return node;},t=SolvexI18n.text;
  container.replaceChildren();
  for(const plan of data.plans){
    const card=make('article',undefined,'plan-card '+plan.id);card.append(make('span',plan.id==='plus'?'SOLVEX PLUS':'SOLVEX FREE','eyebrow'));
    const price=make('div',undefined,'plan-price');price.append(make('strong',plan.price_cents?new Intl.NumberFormat(SolvexI18n.locale,{style:'currency',currency:plan.currency}).format(plan.price_cents/100):t('Бесплатно')));if(plan.price_cents)price.append(make('span',t('в месяц')));card.append(price);
    card.append(make('p',t('{0} AI-запросов в день',plan.chat)),make('p',t('Исследований в день: {0}',plan.research)));
    const button=make('button',t(current===plan.id?'Ваш тариф':plan.id==='free'?'Начать бесплатно':'Оплата скоро'),plan.id==='plus'?'primary':'secondary');button.type='button';button.disabled=Boolean(current)||plan.id==='plus';
    if(!button.disabled)button.onclick=async()=>{try{const session=await SolvexAuth.getSession();if(session)location.assign('/app');else SolvexAuth.open('register','BUSINESS');}catch{SolvexAuth.open('register','BUSINESS');}};
    card.append(button);if(plan.id==='plus'&&!data.checkout_available)card.append(make('small',t('Приём оплаты ещё не подключён.')));container.append(card);
  }
}};
document.addEventListener('DOMContentLoaded',()=>{
  const target=document.getElementById('landing-plans');if(!target)return;let loaded;
  fetch('/api/plans',{cache:'no-store'}).then(async response=>{if(!response.ok)throw new Error();loaded=await response.json();SolvexPlans.render(target,loaded);}).catch(()=>SolvexI18n.set(target,SolvexI18n.text('Не удалось загрузить тарифы. Обновите страницу.')));
  window.addEventListener('solvex:language',()=>{if(loaded)SolvexPlans.render(target,loaded);});
});
