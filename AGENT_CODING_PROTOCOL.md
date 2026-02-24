# AGENT CODING PROTOCOL
## Обязательные правила при написании кода

### 1. ИСПОЛЬЗОВАТЬ Context7 ДЛЯ ДОКУМЕНТАЦИИ (ОБЯЗАТЕЛЬНО)

**Перед написанием ЛЮБОГО кода с использованием библиотек/фреймворков:**

```
ОБЯЗАТЕЛЬНЫЙ ПОРЯДОК ДЕЙСТВИЙ:

1. [Context7] Запросить актуальную документацию
2. [Context7] Получить best practices  
3. [Context7] Найти примеры кода
4. Только после этого писать свой код
5. Проверить соответствие best practices
```

**Когда ОБЯЗАТЕЛЬНО использовать Context7:**
- ✅ Работа с API (REST, GraphQL, WebSocket)
- ✅ Использование библиотек (npm, pip, etc.)
- ✅ Фреймворки (React, Vue, Express, Django, etc.)
- ✅ DevOps инструменты (Docker, Kubernetes, Terraform)
- ✅ Базы данных (PostgreSQL, MongoDB, Redis)
- ✅ Аутентификация/авторизация
- ✅ Работа с файлами, сетью, процессами

**Пример workflow:**
```
❌ НЕПРАВИЛЬНО:
User: "Напиши Docker Compose для PostgreSQL"
Agent: [сразу пишет код из головы]

✅ ПРАВИЛЬНО:
User: "Напиши Docker Compose для PostgreSQL"
Agent: 
1. [Context7] Документация по Docker Compose networking
2. [Context7] PostgreSQL best practices в Docker
3. [Context7] Примеры production-ready конфигураций
4. [Пишет код на основе актуальной документации]
```

### 2. ПОРЯДОК ИСТОЧНИКОВ ИНФОРМАЦИИ

**Приоритет источников (от высшего к низшему):**

1. **Context7** (актуальная документация)
   - MDN, Python docs, Node.js docs
   - Docker, Kubernetes docs
   - React, Vue, Angular docs
   
2. **Web Research** (если Context7 не дал результатов)
   - DuckDuckGo
   - StackExchange
   - Reddit
   - Wikipedia
   
3. **Внутренние знания LLM** (только как fallback)

### 3. ПРОВЕРКА ПЕРЕД КОММИТОМ

```
ЧЕКЛИСТ перед git commit:

□ Использован Context7 для всех библиотек/фреймворков?
□ Код соответствует актуальной документации?
□ Проверены best practices 2024 года?
□ Есть примеры из официальной документации?
□ Нет deprecated методов/функций?
```

### 4. ПРИМЕРЫ ИСПОЛЬЗОВАНИЯ

**Пример 1: Настройка Express.js**
```javascript
// Шаг 1: Запросить документацию
const Context7Client = require('./src/utils/context7-client');
const context7 = new Context7Client();

// Получить актуальную документацию
const docs = await context7.query({
  topic: 'express',
  query: 'middleware best practices'
});

const examples = await context7.getExamples('express', 'router');

// Шаг 2: Написать код на основе документации
// [код здесь]
```

**Пример 2: Работа с PostgreSQL**
```javascript
// Шаг 1: Context7
const bestPractices = await context7.query({
  topic: 'postgresql',
  query: 'connection pooling configuration'
});

// Шаг 2: Код
// [код согласно актуальной документации]
```

### 5. ОШИБКИ И ИСКЛЮЧЕНИЯ

**Если Context7 недоступен:**
1. Использовать Web Research как fallback
2. Проверить официальную документацию вручную
3. Использовать актуальные версии из npm/pypi

**Если документация устаревшая:**
1. Проверить дату публикации
2. Найти более свежие источники
3. Использовать changelog/Release Notes

### 6. ДОКУМЕНТИРОВАНИЕ ИСПОЛЬЗОВАНИЯ

**В комментариях к коду указывать:**
```javascript
/**
 * Основано на документации:
 * - Context7: Express.js 4.x Middleware Guide
 * - MDN: async/await error handling
 * - Дата запроса: 2024-02-24
 */
```

---

## БЫСТРЫЙ СТАРТ

```javascript
// Импорт
const { Context7Client } = require('./src/utils/context7-client');
const context7 = new Context7Client();

// Проверка доступности
if (await context7.isAvailable()) {
  // Получить документацию
  const docs = await context7.query({
    topic: 'react',
    query: 'useEffect cleanup'
  });
  
  // Получить best practices
  const practices = await context7.getBestPractices('docker');
  
  // Получить примеры
  const examples = await context7.getExamples('python', 'asyncio');
}
```

---

**ВАЖНО:** Несоблюдение этого протокола приводит к:
- Устаревшему коду
- Deprecated методам
- Security vulnerabilities
- Несовместимости с новыми версиями

**Каждый коммит должен следовать этому протоколу!**
