"""Disposable browser fixtures. Run only against web.tests.agent_server on 8010."""
import io
import tempfile
from pathlib import Path

import httpx
from PIL import Image, ImageDraw


def seed():
    base = 'http://127.0.0.1:8010'
    owner, team = httpx.Client(base_url=base), httpx.Client(base_url=base)
    for client, role in [(owner, 'BUSINESS'), (team, 'TEAM')]:
        email = 'photos-owner@example.org' if role == 'BUSINESS' else 'photos-team@example.org'
        response = client.post('/api/auth/register', json={'email':email,'password':'synthetic-test-password','role':role})
        response.raise_for_status(); client.headers['X-CSRF-Token']=response.json()['csrf_token']
    owner.put('/api/me/profile',json={'name':'Тестовая компания','location':'Алматы','description':'Синтетический профиль для проверки интерфейса.'}).raise_for_status()
    team.put('/api/me/profile',json={'name':'Тестовая команда','skills':['Аналитика'],'description':'Синтетический профиль для проверки интерфейса.'}).raise_for_status()
    image=Image.new('RGB',(1200,675),'#25394c'); draw=ImageDraw.Draw(image)
    for x in range(80,1120,160):
        for y in range(80,500,135):
            draw.rounded_rectangle((x,y,x+130,y+100),radius=8,fill='#587d8f',outline='#90acb7',width=2)
    draw.text((80,600),'SOLVEX / SYNTHETIC TEST IMAGE',fill='#d9e5ee')
    photo_path=Path(tempfile.gettempdir())/'solvex-collaboration-test.png'; image.save(photo_path)
    data=io.BytesIO();image.save(data,'PNG')
    tasks=[]
    for title,topic in [('Точность складского учёта','Логистика'),('Сократить списания продуктов','Ритейл'),('Упростить обработку заявок','Сервис')]:
        response=owner.post('/api/me/tasks',json={'topic':topic,'card':{'title':title,'context':'Синтетическая задача для проверки интерфейса.','need':'Нужно разобраться в процессе и определить причины потерь.','expected_result':'Понятный план улучшений и критерии проверки.'},'confirmed_fields':['context','need','expected_result']})
        response.raise_for_status();task=response.json();tasks.append(task['id'])
        owner.post(f"/api/me/tasks/{task['id']}/publish").raise_for_status()
    owner.post(f'/api/me/tasks/{tasks[1]}/images',content=data.getvalue()).raise_for_status()
    proposal=team.post(f'/api/catalog/tasks/{tasks[0]}/proposals',json={'idea':'Изучить процесс учёта и причины расхождений.','plan':'Согласовать данные, изучить процесс и подготовить рекомендации.','duration_days':14,'prototype_url':'https://example.org/test-portfolio'})
    proposal.raise_for_status()
    print({'tasks':tasks,'photo_fixture':str(photo_path),'proposal':proposal.json()['id']})


if __name__ == '__main__':
    seed()
