# Context7 MCP Integration

## Что такое Context7

Context7 — это MCP (Model Context Protocol) сервер, который предоставляет LLM доступ к актуальной документации из различных источников:
- MDN (JavaScript, Web APIs)
- Python docs
- Node.js docs
- React, Vue, Angular docs
- Docker, Kubernetes docs
- И многие другие

## Настройка

### 1. Установка (уже добавлена)
```bash
# Автоматически через npx, ничего устанавливать не нужно
```

### 2. Получение API Token (опционально)
```bash
# Регистрация: https://upstash.com/
# Context7 token даёт расширенные лимиты
export CONTEXT7_API_TOKEN="your_token_here"
```

### 3. Конфигурация
Файл `.cursor/mcp.json` уже создан с настройками.

## Использование при разработке

### Когда использовать Context7:

**ОБЯЗАТЕЛЬНО использовать Context7 при:**
- ✅ Написании кода с использованием библиотек/фреймворков
- ✅ Проектировании архитектуры
- ✅ Работе с API (REST, GraphQL, etc.)
- ✅ Настройке DevOps инструментов
- ✅ Изучении новых технологий

**Примеры запросов к Context7:**
```
"Покажи актуальную документацию по Docker Compose для версии 3.8"
"Какие best practices для React Hooks в 2024 году?"
"Объясни разницу между async/await и Promises с примерами из MDN"
"Как настроить Kubernetes Ingress Controller?"
```

### Интеграция в рабочий процесс

**Before writing any code:**
1. Запросить актуальную документацию через Context7
2. Изучить best practices и примеры
3. Применить в коде

**Пример workflow:**
```
User: "Нужно настроить PostgreSQL репликацию"

Agent:
1. [Context7] Запросить документацию по PostgreSQL replication
2. [Context7] Получить примеры конфигурации
3. Написать код на основе актуальной документации
4. Проверить соответствие best practices
```

## Доступные источники документации

### JavaScript/TypeScript
- MDN Web Docs
- Node.js docs
- TypeScript handbook

### Frontend Frameworks
- React docs
- Vue.js docs
- Angular docs
- Svelte docs

### Backend
- Express.js docs
- Fastify docs
- NestJS docs
- Django docs
- Flask docs

### DevOps
- Docker docs
- Kubernetes docs
- Terraform docs
- Ansible docs

### Databases
- PostgreSQL docs
- MongoDB docs
- Redis docs
- Elasticsearch docs

## Использование в коде

```javascript
// Пример: Получение документации перед написанием кода
const Context7Client = require('./src/utils/context7-client');

async function implementFeature() {
  // 1. Получить актуальную документацию
  const docs = await Context7Client.query({
    topic: 'docker-compose',
    version: '3.8',
    section: 'networking'
  });
  
  // 2. Изучить best practices
  const bestPractices = await Context7Client.query({
    topic: 'docker-compose',
    query: 'best practices production 2024'
  });
  
  // 3. Написать код на основе документации
  // ... код ...
}
```

## Проверка работоспособности

```bash
# Тест Context7 MCP
npx @upstash/context7-mcp@latest --help
```

## Troubleshooting

**Problem:** Context7 не отвечает
**Solution:** Проверить интернет-соединение, использовать fallback на web search

**Problem:** Rate limit exceeded
**Solution:** Получить API token на upstash.com

## Интеграция с Knowledge System

При обработке тем в Deep Learning:
1. Сначала проверить Context7 для технических тем
2. Затем использовать web search как fallback
3. Объединить результаты для генерации контента
