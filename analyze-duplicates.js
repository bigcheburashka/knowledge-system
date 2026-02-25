#!/usr/bin/env node
/**
 * Analyze Post-Learning Expander Duplicates
 * Проверка дублей, созданных post-learning-expander
 */

const fs = require('fs').promises;
const path = require('path');

const TOPICS_PATH = '/root/.openclaw/workspace/knowledge-system/custom-topics.json';

async function analyzeDuplicates() {
  console.log('🔍 Анализ дублей Post-Learning Expander\n');
  console.log('=' .repeat(70));
  
  try {
    const content = await fs.readFile(TOPICS_PATH, 'utf8');
    const data = JSON.parse(content);
    
    const topics = data.topics || [];
    
    console.log(`\n📊 Всего тем в очереди: ${topics.length}\n`);
    
    // 1. Найти темы от post-learning-expander
    const postLearningTopics = topics.filter(t => 
      t.addedBy === 'post-learning-expander' || 
      t.source === 'type-based' ||
      t.source === 'rule-based'
    );
    
    console.log(`📝 Тем от Post-Learning Expander: ${postLearningTopics.length}`);
    
    // 2. Группировать по parentTopic
    const byParent = {};
    for (const topic of postLearningTopics) {
      const parent = topic.parentTopic || 'unknown';
      if (!byParent[parent]) {
        byParent[parent] = [];
      }
      byParent[parent].push(topic);
    }
    
    console.log(`\n🔗 Уникальных родительских тем: ${Object.keys(byParent).length}\n`);
    
    // 3. Найти паттерны расширения
    const expansionPatterns = {};
    const duplicates = [];
    
    for (const [parent, children] of Object.entries(byParent)) {
      // Нормализуем имя родителя
      const normalizedParent = parent.toLowerCase().trim();
      
      for (const child of children) {
        const childName = child.name.toLowerCase().trim();
        
        // Проверяем, содержит ли дочерняя тема имя родителя
        if (childName.includes(normalizedParent)) {
          // Извлекаем суффикс
          const suffix = childName.replace(normalizedParent, '').trim()
            .replace(/^[\s\-–—]+/, '')
            .replace(/[\s\-–—]+$/, '');
          
          if (suffix) {
            if (!expansionPatterns[suffix]) {
              expansionPatterns[suffix] = [];
            }
            expansionPatterns[suffix].push({
              parent: parent,
              child: child.name,
              priority: child.priority
            });
          }
        }
      }
    }
    
    // 4. Статистика по паттернам
    console.log('📈 Паттерны расширения (type-based):\n');
    
    const sortedPatterns = Object.entries(expansionPatterns)
      .sort((a, b) => b[1].length - a[1].length);
    
    for (const [pattern, items] of sortedPatterns.slice(0, 20)) {
      console.log(`  "${pattern}": ${items.length} тем`);
      // Показать первые 3 примера
      items.slice(0, 3).forEach(item => {
        console.log(`    - ${item.parent} → ${item.child}`);
      });
      if (items.length > 3) {
        console.log(`    ... и ещё ${items.length - 3}`);
      }
      console.log('');
    }
    
    // 5. Проверка на потенциальные дубли
    console.log('=' .repeat(70));
    console.log('🔎 Проверка на дубли:\n');
    
    // Найти темы с одинаковыми именами
    const nameCounts = {};
    for (const topic of topics) {
      const name = topic.name.toLowerCase().trim();
      if (!nameCounts[name]) {
        nameCounts[name] = [];
      }
      nameCounts[name].push(topic);
    }
    
    const exactDuplicates = Object.entries(nameCounts)
      .filter(([name, items]) => items.length > 1);
    
    if (exactDuplicates.length > 0) {
      console.log(`⚠️  Найдено ${exactDuplicates.length} точных дублей:\n`);
      exactDuplicates.forEach(([name, items]) => {
        console.log(`  "${name}" — ${items.length} копий:`);
        items.forEach((item, i) => {
          console.log(`    ${i + 1}. addedBy: ${item.addedBy || 'unknown'}, source: ${item.source || 'unknown'}`);
        });
      });
    } else {
      console.log('✅ Точных дублей не найдено');
    }
    
    // 6. Проверка на похожие имена (возможные дубли)
    console.log('\n📋 Похожие имена (возможные дубли):\n');
    
    const similarGroups = findSimilarNames(topics);
    if (similarGroups.length > 0) {
      similarGroups.slice(0, 10).forEach((group, i) => {
        console.log(`  Группа ${i + 1}:`);
        group.forEach(name => console.log(`    - ${name}`));
      });
    } else {
      console.log('  Похожих имён не обнаружено');
    }
    
    // 7. Статистика по источникам
    console.log('\n' + '=' .repeat(70));
    console.log('📊 Статистика по источникам:\n');
    
    const bySource = {};
    for (const topic of topics) {
      const source = topic.source || topic.addedBy || 'unknown';
      if (!bySource[source]) {
        bySource[source] = 0;
      }
      bySource[source]++;
    }
    
    Object.entries(bySource)
      .sort((a, b) => b[1] - a[1])
      .forEach(([source, count]) => {
        const percent = ((count / topics.length) * 100).toFixed(1);
        console.log(`  ${source}: ${count} (${percent}%)`);
      });
    
    // 8. Итоговые цифры
    console.log('\n' + '=' .repeat(70));
    console.log('📈 ИТОГО:\n');
    
    const totalExpansions = Object.values(expansionPatterns)
      .reduce((sum, items) => sum + items.length, 0);
    
    console.log(`  Всего тем: ${topics.length}`);
    console.log(`  Тем от Post-Learning Expander: ${postLearningTopics.length}`);
    console.log(`  Расширений (X → X - suffix): ${totalExpansions}`);
    console.log(`  Точных дублей: ${exactDuplicates.length}`);
    console.log(`  Уникальных паттернов расширения: ${sortedPatterns.length}`);
    
    // Потенциальная экономия
    const uniqueBaseTopics = Object.keys(byParent).length;
    const avgExpansionsPerTopic = (postLearningTopics.length / uniqueBaseTopics).toFixed(1);
    console.log(`  Среднее расширений на тему: ${avgExpansionsPerTopic}`);
    
  } catch (error) {
    console.error('❌ Ошибка:', error.message);
    process.exit(1);
  }
}

/**
 * Найти похожие имена (упрощённая версия)
 */
function findSimilarNames(topics) {
  const groups = [];
  const processed = new Set();
  
  for (let i = 0; i < topics.length; i++) {
    const name1 = topics[i].name.toLowerCase();
    if (processed.has(name1)) continue;
    
    const group = [topics[i].name];
    processed.add(name1);
    
    for (let j = i + 1; j < topics.length; j++) {
      const name2 = topics[j].name.toLowerCase();
      
      // Проверяем, что одно имя содержит другое
      if (name1 !== name2 && (name1.includes(name2) || name2.includes(name1))) {
        // Проверяем, что разница небольшая
        const longer = name1.length > name2.length ? name1 : name2;
        const shorter = name1.length > name2.length ? name2 : name1;
        
        // Если разница меньше 30% от длинного имени
        if ((longer.length - shorter.length) / longer.length < 0.3) {
          group.push(topics[j].name);
          processed.add(name2);
        }
      }
    }
    
    if (group.length > 1) {
      groups.push(group);
    }
  }
  
  return groups;
}

analyzeDuplicates();
