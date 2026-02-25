#!/usr/bin/env node
/**
 * Clean learned topics from queue
 * Удаление изученных тем из очереди
 */

const fs = require('fs').promises;
const axios = require('axios');

const TOPICS_PATH = '/root/.openclaw/workspace/knowledge-system/custom-topics.json';
const QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:6333';
const COLLECTION = 'knowledge';

async function cleanLearnedTopics() {
  console.log('🧹 Очистка изученных тем из очереди\n');
  console.log('='.repeat(70));
  
  try {
    // Читаем очередь
    const content = await fs.readFile(TOPICS_PATH, 'utf8');
    const data = JSON.parse(content);
    
    console.log(`\n📊 Исходное количество: ${data.topics.length} тем\n`);
    
    // Проверяем каждую тему
    const remaining = [];
    const removed = [];
    
    for (const topic of data.topics) {
      try {
        const response = await axios.post(`${QDRANT_URL}/collections/${COLLECTION}/points/scroll`, {
          filter: { must: [{ key: 'name', match: { value: topic.name } }] },
          limit: 1
        }, { timeout: 5000 });
        
        const exists = response.data.result.points?.length > 0;
        
        if (exists) {
          removed.push(topic.name);
        } else {
          remaining.push(topic);
        }
      } catch (e) {
        // Если ошибка, оставляем в очереди
        remaining.push(topic);
      }
    }
    
    // Сохраняем очищенную очередь
    data.topics = remaining;
    await fs.writeFile(TOPICS_PATH, JSON.stringify(data, null, 2));
    
    // Результаты
    console.log(`✅ Удалено изученных тем: ${removed.length}`);
    removed.slice(0, 20).forEach((t, i) => {
      console.log(`  ${i + 1}. ${t}`);
    });
    if (removed.length > 20) {
      console.log(`  ... и ещё ${removed.length - 20}`);
    }
    
    console.log(`\n📊 Осталось в очереди: ${remaining.length} тем`);
    
    // Статистика по приоритетам
    const byPriority = {};
    remaining.forEach(t => {
      const p = t.priority || 'unknown';
      byPriority[p] = (byPriority[p] || 0) + 1;
    });
    
    console.log('\n📋 По приоритетам:');
    Object.entries(byPriority).forEach(([p, c]) => {
      console.log(`  ${p}: ${c}`);
    });
    
    console.log('\n' + '='.repeat(70));
    console.log('✅ Очередь очищена!');
    
  } catch (error) {
    console.error('❌ Ошибка:', error.message);
    process.exit(1);
  }
}

cleanLearnedTopics();
