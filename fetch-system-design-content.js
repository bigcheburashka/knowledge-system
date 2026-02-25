#!/usr/bin/env node
/**
 * System Design Content Fetcher + Deep Learning
 * Явный фетчинг контента с system-design.space + изучение
 */

const fs = require('fs').promises;
const axios = require('axios');
const cheerio = require('cheerio');
const path = require('path');

const TOPICS_FILE = path.join(__dirname, 'custom-topics.json');
const BASE_URL = 'https://system-design.space';

// Конвертация названия темы в URL slug
function toSlug(name) {
  return name
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')  // Удаляем спецсимволы кроме пробелов и дефисов
    .replace(/\s+/g, '-')       // Пробелы → дефисы
    .replace(/-+/g, '-')        // Множественные дефисы → один
    .replace(/^-|-$/g, '');     // Удаляем дефисы в начале/конце
}

// Фетчинг страницы с сайта
async function fetchPage(url) {
  try {
    console.log(`  🌐 Fetching: ${url}`);
    const response = await axios.get(url, {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    const $ = cheerio.load(response.data);
    
    // Извлекаем основной контент
    const title = $('h1').first().text().trim() || $('title').text().trim();
    
    // Ищем основной контент — обычно это article или main
    let content = '';
    const selectors = ['article', 'main', '.content', '[role="main"]', 'body'];
    
    for (const selector of selectors) {
      const element = $(selector);
      if (element.length > 0) {
        // Удаляем навигацию, рекламу и т.д.
        element.find('nav, header, footer, aside, .advertisement, script, style').remove();
        content = element.text().trim();
        if (content.length > 500) break;
      }
    }
    
    // Извлекаем ключевые разделы (h2, h3)
    const sections = [];
    $('h2, h3').each((i, el) => {
      const text = $(el).text().trim();
      if (text && text.length > 5 && text.length < 200) {
        sections.push(text);
      }
    });
    
    return {
      success: true,
      title,
      content: content.substring(0, 10000), // Лимит 10K символов
      sections: sections.slice(0, 20),
      url
    };
    
  } catch (error) {
    console.log(`  ❌ Failed: ${error.message}`);
    return { success: false, error: error.message };
  }
}

// Пробуем разные варианты URL
async function fetchWithVariations(topic) {
  const slug = toSlug(topic);
  
  // Варианты URL
  const urls = [
    `${BASE_URL}/chapter/${slug}`,
    `${BASE_URL}/en/chapter/${slug}`,
  ];
  
  for (const url of urls) {
    const result = await fetchPage(url);
    if (result.success && result.content.length > 500) {
      return result;
    }
  }
  
  return { success: false, error: 'All URL variations failed' };
}

// Основная функция
async function processTopics() {
  console.log('🚀 System Design Content Fetcher + Deep Learning\n');
  
  // Загружаем темы
  let data;
  try {
    const content = await fs.readFile(TOPICS_FILE, 'utf8');
    data = JSON.parse(content);
  } catch {
    console.error('❌ Cannot read topics file');
    process.exit(1);
  }
  
  // Фильтруем только system-design-space темы
  const topics = data.topics.filter(t => t.source === 'system-design-space');
  console.log(`📚 Found ${topics.length} topics to process\n`);
  
  const results = {
    fetched: 0,
    failed: 0,
    stored: 0
  };
  
  // Обрабатываем пачками по 5
  const batchSize = 5;
  for (let i = 0; i < topics.length; i += batchSize) {
    const batch = topics.slice(i, i + batchSize);
    console.log(`\n📦 Batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(topics.length / batchSize)}`);
    console.log('='.repeat(70));
    
    for (const topic of batch) {
      console.log(`\n📝 Topic: ${topic.name}`);
      
      // 1. Фетчим контент с сайта
      const fetched = await fetchWithVariations(topic.name);
      
      if (!fetched.success) {
        console.log(`  ⚠️  Fetch failed: ${fetched.error}`);
        results.failed++;
        continue;
      }
      
      console.log(`  ✅ Fetched: ${fetched.content.length} chars, ${fetched.sections.length} sections`);
      results.fetched++;
      
      // 2. Сохраняем raw контент для последующей обработки
      const outputDir = path.join(__dirname, '..', 'data', 'system-design-raw');
      await fs.mkdir(outputDir, { recursive: true });
      
      const safeName = toSlug(topic.name);
      const outputFile = path.join(outputDir, `${safeName}.json`);
      
      await fs.writeFile(outputFile, JSON.stringify({
        topic: topic.name,
        source: 'system-design.space',
        url: fetched.url,
        title: fetched.title,
        content: fetched.content,
        sections: fetched.sections,
        fetchedAt: new Date().toISOString()
      }, null, 2));
      
      console.log(`  💾 Saved to: ${outputFile}`);
      
      // 3. Добавляем в очередь Deep Learning с пометкой что контент уже есть
      topic.fetchedContent = outputFile;
      topic.fetchedAt = new Date().toISOString();
    }
    
    // Пауза между пачками
    if (i + batchSize < topics.length) {
      console.log('\n⏳ Waiting 2 seconds before next batch...');
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  
  // Сохраняем обновленные темы
  await fs.writeFile(TOPICS_FILE, JSON.stringify(data, null, 2));
  
  // Итоги
  console.log('\n' + '='.repeat(70));
  console.log('📊 SUMMARY');
  console.log('='.repeat(70));
  console.log(`Total topics: ${topics.length}`);
  console.log(`Successfully fetched: ${results.fetched}`);
  console.log(`Failed: ${results.failed}`);
  console.log(`\n💡 Next step: Run deep-learning.js to process fetched content`);
  
  return results;
}

// Запуск
processTopics().catch(console.error);
