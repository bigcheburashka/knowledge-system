# Другие бесплатные поисковые API

## 1. **SearXNG** (Самый лучший бесплатный вариант)
- **Что это:** Self-hosted мета-поисковик (агрегирует Google, Bing, DDG)
- **Цена:** Полностью бесплатно (self-hosted)
- **Лимиты:** Зависит от вашего сервера
- **Установка:** Docker доступен
- **Плюсы:** Никаких API ключей, множество источников, приватность
- **Минусы:** Нужно хостить самому или найти публичный инстанс

```javascript
// Использование публичного SearXNG
const response = await axios.get('https://searx.be/search', {
  params: {
    q: query,
    format: 'json',
    engines: 'google,bing,duckduckgo'
  }
});
```

## 2. **Wikipedia API** (Для фактов)
- **Цена:** Бесплатно
- **Лимиты:** Нет жёстких лимитов
- **Use case:** Факты, термины, концепции

```javascript
const response = await axios.get('https://en.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(query));
```

## 3. **GitHub Search API** (Уже используем)
- **Цена:** Бесплатно (60 запросов/час без auth, 5000 с auth)
- **Лимиты:** 1000 результатов

## 4. **Reddit API** (Обсуждения)
- **Цена:** Бесплатно
- **Use case:** Мнения, обсуждения технологий

```javascript
const response = await axios.get('https://www.reddit.com/search.json', {
  params: { q: query, limit: 25 }
});
```

## 5. **StackExchange API** (Q&A)
- **Цена:** Бесплатно
- **Лимиты:** 300 запросов/сутки
- **Use case:** Технические вопросы и ответы

```javascript
const response = await axios.get('https://api.stackexchange.com/2.3/search', {
  params: {
    order: 'desc',
    sort: 'relevance',
    intitle: query,
    site: 'stackoverflow'
  }
});
```

## 6. **YouTube Data API** (Видео)
- **Цена:** Бесплатно (10000 единиц/день)
- **Use case:** Туториалы, доклады

## Рекомендации:

**Если нужен мощный поиск:** SearXNG (self-hosted)
**Если достаточно DDG:** Python-версия (уже добавлена)
**Для технических тем:** StackExchange + Reddit
**Для фактов:** Wikipedia

Хочешь добавить SearXNG или другие?
