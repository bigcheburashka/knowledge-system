#!/usr/bin/env node
/**
 * System Design Content Fetcher v2
 * Использует точный mapping из sitemap
 */

const fs = require('fs').promises;
const axios = require('axios');
const cheerio = require('cheerio');
const path = require('path');
const { XMLParser } = require('fast-xml-parser');

const BASE_URL = 'https://system-design.space';
const RAW_DIR = '/root/.openclaw/workspace/data/system-design-raw-v2';

// Парсинг sitemap для получения точных URL
async function parseSitemap() {
  console.log('🗺️  Parsing sitemap...\n');
  
  try {
    const response = await axios.get(`${BASE_URL}/sitemap.xml`, { timeout: 30000 });
    const parser = new XMLParser();
    const sitemap = parser.parse(response.data);
    
    const urls = sitemap.urlset.url.map(u => ({
      url: u.loc,
      lastmod: u.lastmod,
      // Извлекаем slug из URL
      slug: u.loc.replace(`${BASE_URL}/`, '').replace('en/', ''),
      isEnglish: u.loc.includes('/en/')
    }));
    
    console.log(`  ✅ Found ${urls.length} URLs`);
    console.log(`  📝 Russian: ${urls.filter(u => !u.isEnglish).length}`);
    console.log(`  📝 English: ${urls.filter(u => u.isEnglish).length}\n`);
    
    return urls;
  } catch (error) {
    console.error('❌ Failed to parse sitemap:', error.message);
    return [];
  }
}

// Фетчинг страницы
async function fetchPage(url) {
  try {
    const response = await axios.get(url, {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    const $ = cheerio.load(response.data);
    const title = $('h1').first().text().trim() || $('title').text().trim();
    
    // Извлекаем контент
    let content = '';
    const selectors = ['article', 'main', '.content', '[role="main"]'];
    
    for (const selector of selectors) {
      const element = $(selector);
      if (element.length > 0) {
        element.find('nav, header, footer, aside, script, style').remove();
        content = element.text().trim();
        if (content.length > 300) break;
      }
    }
    
    // Если не нашли через селекторы — берём body
    if (content.length < 300) {
      $('body').find('nav, header, footer, script, style').remove();
      content = $('body').text().trim();
    }
    
    // Извлекаем разделы
    const sections = [];
    $('h2, h3').each((i, el) => {
      const text = $(el).text().trim();
      if (text && text.length > 3 && text.length < 200) {
        sections.push(text);
      }
    });
    
    return {
      success: true,
      title,
      content: content.substring(0, 15000),
      sections: sections.slice(0, 15),
      url,
      length: content.length
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Основная функция
async function main() {
  console.log('🚀 System Design Content Fetcher v2\n');
  console.log('='.repeat(70));
  
  // Создаём директорию
  await fs.mkdir(RAW_DIR, { recursive: true });
  
  // Получаем URL из sitemap
  const urls = await parseSitemap();
  if (urls.length === 0) {
    console.error('❌ No URLs found');
    process.exit(1);
  }
  
  // Фильтруем только русские URL (без /en/)
  const russianUrls = urls.filter(u => !u.isEnglish);
  console.log(`📚 Processing ${russianUrls.length} Russian URLs\n`);
  
  const results = { success: 0, failed: 0, totalChars: 0 };
  
  // Обрабатываем пачками по 3
  const batchSize = 3;
  for (let i = 0; i < russianUrls.length; i += batchSize) {
    const batch = russianUrls.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(russianUrls.length / batchSize);
    
    console.log(`\n📦 Batch ${batchNum}/${totalBatches}`);
    console.log('-'.repeat(70));
    
    for (const { url, slug } of batch) {
      const filename = slug.replace(/\//g, '-') + '.json';
      const filepath = path.join(RAW_DIR, filename);
      
      // Пропускаем если уже скачано
      try {
        await fs.access(filepath);
        console.log(`  ⏩ Skipped: ${slug} (already exists)`);
        continue;
      } catch {
        // Файла нет — продолжаем
      }
      
      console.log(`  🌐 ${slug.substring(0, 50)}...`);
      const fetched = await fetchPage(url);
      
      if (!fetched.success) {
        console.log(`  ❌ Failed: ${fetched.error}`);
        results.failed++;
        continue;
      }
      
      // Сохраняем
      await fs.writeFile(filepath, JSON.stringify({
        url,
        slug,
        title: fetched.title,
        content: fetched.content,
        sections: fetched.sections,
        length: fetched.length,
        fetchedAt: new Date().toISOString()
      }, null, 2));
      
      console.log(`  ✅ Saved: ${fetched.length} chars, ${fetched.sections.length} sections`);
      results.success++;
      results.totalChars += fetched.length;
    }
    
    // Пауза между пачками
    if (i + batchSize < russianUrls.length) {
      console.log('  ⏳ Waiting 1.5s...');
      await new Promise(r => setTimeout(r, 1500));
    }
  }
  
  // Итоги
  console.log('\n' + '='.repeat(70));
  console.log('📊 SUMMARY');
  console.log('='.repeat(70));
  console.log(`Total URLs: ${russianUrls.length}`);
  console.log(`✅ Successfully fetched: ${results.success}`);
  console.log(`❌ Failed: ${results.failed}`);
  console.log(`📝 Total content: ${results.totalChars.toLocaleString()} chars`);
  console.log(`📁 Saved to: ${RAW_DIR}`);
  console.log('\n💡 Next: Run deep learning on fetched content');
}

main().catch(console.error);
