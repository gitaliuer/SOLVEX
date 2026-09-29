"""Transparent profile-term matching. No generated claims or probability scores."""
import re


# Explicit equivalents, intentionally small. Evidence always accompanies a match.
SKILLS = {
    'analysis': ('Анализ данных', r'аналитик\w*|анализ\w*|отчет\w*|data analysis|analytics'),
    'web': ('Веб-разработка', r'веб[ -]?(?:разработ\w*|приложени\w*|сайт\w*)|сайт\w*|web development|web app\w*|frontend|фронтенд\w*'),
    'design': ('Дизайн интерфейсов', r'ux|ui|дизайн\w*|design|прототип\w* интерфейс\w*'),
    'backend': ('Серверная разработка', r'backend|бэкенд\w*|бекенд\w*|api|серверн\w* разработ\w*'),
    'ml': ('Машинное обучение', r'машинн\w* обучени\w*|machine learning|ml|нейросет\w*'),
    'mobile': ('Мобильная разработка', r'мобильн\w* (?:приложени\w*|разработ\w*)|mobile development|android|ios'),
    'visualization': ('Визуализация', r'визуализац\w*|дашборд\w*|dashboard\w*|visualization'),
    'research': ('Исследования', r'исследовани\w*|research|интервью'),
}
TOPICS = [('ритейл', 'retail'), ('образование', 'education'), ('экология', 'ecology'),
          ('медицина', 'здравоохранение', 'healthcare')]


def normalize(value):
    return ' '.join(value.casefold().replace('ё', 'е').split())


def pattern(expression):
    return re.compile(r'(?<![\w+#])(?:' + expression + r')(?![\w+#])', re.I)


def positive_evidence(expression, field, text, confirmed):
    normalized = text.casefold().replace('ё', 'е')
    for match in pattern(expression).finditer(normalized):
        before = re.split(r'[.;!?\n]|\b(?:но|однако|but)\b', normalized[:match.start()])[-1]
        before = ' '.join(before.split()[-5:])
        after = normalized[match.end():].split('.')[0][:65]
        if re.search(r'\b(?:не|без|нельзя|запрещ\w*|not|no|without)\b', before):
            continue
        if re.match(r'\s*(?:не\s+(?:нуж\w*|требу\w*|использ\w*)|запрещ\w*|нежелател\w*|not needed)', after):
            continue
        start, end = max(0, match.start() - 65), min(len(text), match.end() + 110)
        return {'field': field, 'excerpt': ('…' if start else '') + text[start:end] + ('…' if end < len(text) else ''),
                'term': text[match.start():match.end()], 'confirmed': field in confirmed}
    return None


def find_evidence(expression, task, fields):
    for field in fields:
        result = positive_evidence(expression, field, task['card'].get(field, ''), task['confirmed_fields'])
        if result:
            return result
    return None


def recommendations(task, teams):
    skill_fields = ('expected_result', 'need', 'title')
    signals = []
    for key, (label, expression) in SKILLS.items():
        evidence = find_evidence(expression, task, skill_fields)
        if evidence:
            signals.append({'key': key, 'label': label, **evidence})
    results = []
    for team in teams:
        reasons, matched = [], set()
        for tag in team['skills']:
            aliases = [key for key, (_, expression) in SKILLS.items() if positive_evidence(expression, "", tag, [])]
            for signal in signals:
                if signal['key'] in aliases and signal['key'] not in matched:
                    reasons.append({'kind': 'skill', 'profile_value': tag, **signal})
                    matched.add(signal['key'])
            if not aliases:
                key = 'literal:' + normalize(tag)
                evidence = find_evidence(re.escape(normalize(tag)), task, skill_fields)
                if evidence and key not in matched:
                    matched.add(key)
                    reasons.append({'kind': 'skill', 'key': key, 'label': tag, 'profile_value': tag, **evidence})
        technologies = set()
        for tag in team['technologies']:
            key = normalize(tag)
            evidence = find_evidence(re.escape(key), task, (*skill_fields, 'constraints'))
            if evidence and key not in technologies:
                technologies.add(key)
                reasons.append({'kind': 'technology', 'label': tag, 'profile_value': tag, **evidence})
        topic = normalize(task['topic'])
        equivalents = next((group for group in TOPICS if topic in group), (topic,))
        for interest in team['interests']:
            if topic not in ('', 'без темы') and normalize(interest) in equivalents:
                reasons.append({'kind': 'topic', 'label': task['topic'], 'profile_value': interest,
                                'field': 'topic', 'term': task['topic'], 'excerpt': task['topic'], 'confirmed': False})
                break
        gaps = [signal['label'] for signal in signals if signal['key'] not in matched]
        results.append({'team': team, 'reasons': reasons, 'gaps': gaps})
    results.sort(key=lambda result: (
        -sum(r['kind'] == 'skill' for r in result['reasons']),
        -sum(r['kind'] == 'technology' for r in result['reasons']),
        -sum(r['kind'] == 'topic' for r in result['reasons']), result['team']['id']))
    return results, signals
