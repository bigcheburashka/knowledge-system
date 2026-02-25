#!/usr/bin/env node
/**
 * Clean Type-Based Expansions from Queue
 * Удаление тем с расширениями типа "X - deployment", "X - tools" и т.д.
 */

const fs = require('fs').promises;
const path = require('path');

const TOPICS_PATH = '/root/.openclaw/workspace/knowledge-system/custom-topics.json';
const BACKUP_PATH = '/root/.openclaw/workspace/knowledge-system/custom-topics-backup.json';

// Паттерны type-based расширений для удаления
const TYPE_BASED_SUFFIXES = [
  ' - deployment',
  ' - tools',
  ' - common-mistakes',
  ' - common mistakes',
  ' - best-practices',
  ' - best practices',
  ' - advanced best practices'
];

async function cleanQueue() {
  console.log('🧹 Очистка очереди от type-based расширений\n');
  console.log('=' .repeat(70));
  
  try {
    // Читаем файл
    const content = await fs.readFile(TOPICS_PATH, 'utf8');
    const data = JSON.parse(content);
    
    const originalCount = data.topics.length;
    console.log(`\n📊 Исходное количество тем: ${originalCount}\n`);
    
    // Создаём backup
    await fs.writeFile(BACKUP_PATH, content);
    console.log(`💾 Backup создан: ${BACKUP_PATH}\n`);
    
    // Фильтруем темы
    const removed = [];
    const kept = [];
    
    for (const topic of data.topics) {
      const name = topic.name;
      const source = topic.source || topic.addedBy;
      
      // Проверяем, является ли тема type-based расширением
      const isTypeBased = 
        source === 'type-based' ||
        TYPE_BASED_SUFFIXES.some(suffix => 
          name.toLowerCase().includes(suffix.toLowerCase())
        );
      
      if (isTypeBased) {
        removed.push({
          name: topic.name,
          source: source,
          priority: topic.priority
        });
      } else {
        kept.push(topic);
      }
    }
    
    // Статистика по удалённым
    console.log('🗑️  Удалённые темы (по источникам):\n');
    
    const bySource = {};
    for (const item of removed) {
      const src = item.source || 'unknown';
      if (!bySource[src]) {
        bySource[src] = [];
      }
      bySource[src].push(item);
    }
    
    Object.entries(bySource)
      .sort((a, b) => b[1].length - a[1].length)
      .forEach(([source, items]) => {
        console.log(`  ${source}: ${items.length} тем`);
      });
    
    // Примеры удалённых
    console.log('\n📋 Примеры удалённых тем (первые 10):\n');
    removed.slice(0, 10).forEach((item, i) => {
      console.log(`  ${i + 1}. ${item.name}`);
    });
    if (removed.length > 10) {
      console.log(`  ... и ещё ${removed.length - 10}`);
    }
    
    // Сохраняем очищенный список
    data.topics = kept;
    await fs.writeFile(TOPICS_PATH, JSON.stringify(data, null, 2));
    
    // Итоги
    console.log('\n' + '=' .repeat(70));
    console.log('📈 ИТОГИ:\n');
    console.log(`  Исходное количество: ${originalCount}`);
    console.log(`  Удалено: ${removed.length}`);
    console.log(`  Осталось: ${kept.length}`);
    console.log(`  Сокращение: ${((removed.length / originalCount) * 100).toFixed(1)}%`);
    
    console.log('\n✅ Очередь очищена!');
    console.log(`💾 Backup сохранён в: ${BACKUP_PATH}`);
    console.log(`📝 Для восстановления: cp ${BACKUP_PATH} ${TOPICS_PATH}`);
    
  } catch (error) {
    console.error('❌ Ошибка:', error.message);
    process.exit(1);
  }
}

// Показать preview без удаления
async function preview() {
  console.log('👁️  PREVIEW: Что будет удалено\n');
  console.log('=' .repeat(70));
  
  try {
    const content = await fs.readFile(TOPICS_PATH, 'utf8');
    const data = JSON.parse(content);
    
    const toRemove = data.topics.filter(topic => {
      const name = topic.name;
      const source = topic.source || topic.addedBy;
      
      return source === 'type-based' ||
        TYPE_BASED_SUFFIXES.some(suffix => 
          name.toLowerCase().includes(suffix.toLowerCase())
        );
    });
    
    const remaining = data.topics.length - toRemove.length;
    
    console.log(`\n📊 Будет удалено: ${toRemove.length} тем`);
    console.log(`📊 Останется: ${remaining} тем`);
    console.log(`📊 Сокращение: ${((toRemove.length / data.topics.length) * 100).toFixed(1)}%\n`);
    
    console.log('Первые 20 тем на удаление:\n');
    toRemove.slice(0, 20).forEach((t, i) => {
      console.log(`  ${i + 1}. ${t.name}`);
    });
    
  } catch (error) {
    console.error('❌ Ошибка:', error.message);
  }
}

// CLI
const command = process.argv[2];

if (command === 'clean') {
  cleanQueue();
} else if (command === 'preview') {
  preview();
} else {
  console.log('Usage: node clean-type-expansions.js [preview|clean]');
  console.log('');
  console.log('Commands:');
  console.log('  preview    Показать, что будет удалено');
  console.log('  clean      Выполнить очистку (создаст backup)');
}
