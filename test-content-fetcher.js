#!/usr/bin/env node
/**
 * Test script for enhanced Content Fetcher
 * Тестирование фетчинга топ-20 сайтов с выжимкой контента
 */

const { WebResearch } = require('./src/evolution/web-research');

async function testContentFetcher() {
  console.log('🧪 Testing Enhanced Content Fetcher\n');
  console.log('=' .repeat(60));
  
  const webResearch = new WebResearch();
  const topic = process.argv[2] || 'Docker best practices';
  
  console.log(`\n📚 Topic: ${topic}\n`);
  
  try {
    // Собираем данные с новым fetcher
    const startTime = Date.now();
    
    const researchData = await webResearch.collectResearchData(topic, {
      webSearch: true,
      githubSearch: true,
      findDocs: true,
      fetchContent: true
    });
    
    const duration = (Date.now() - startTime) / 1000;
    
    console.log('\n' + '='.repeat(60));
    console.log('📊 RESULTS');
    console.log('='.repeat(60));
    
    console.log(`\n⏱️  Duration: ${duration.toFixed(1)}s`);
    
    // Результаты поиска
    console.log(`\n🔍 Search Results: ${researchData.searchResults.length}`);
    researchData.searchResults.slice(0, 5).forEach((r, i) => {
      console.log(`  ${i + 1}. ${r.title}`);
      console.log(`     ${r.url}`);
    });
    
    // GitHub репозитории
    console.log(`\n📦 GitHub Repos: ${researchData.githubRepos.length}`);
    researchData.githubRepos.slice(0, 5).forEach((r, i) => {
      console.log(`  ${i + 1}. ${r.fullName} (${r.stars}⭐)`);
    });
    
    // Документация
    console.log(`\n📖 Documentation: ${researchData.documentation || 'Not found'}`);
    
    // Фетченные сайты
    console.log(`\n🌐 Fetched Sites: ${researchData.fetchedSites.length}`);
    
    if (researchData.fetchedSites.length > 0) {
      console.log('\n  Top fetched sites:');
      researchData.fetchedSites.slice(0, 5).forEach((site, i) => {
        console.log(`    ${i + 1}. ${site.title}`);
        console.log(`       URL: ${site.url}`);
        console.log(`       Type: ${site.contentType} | Words: ${site.wordCount} | Relevance: ${(site.relevanceScore * 100).toFixed(0)}%`);
        console.log(`       Summary: ${site.summary.substring(0, 150)}...`);
        console.log(`       Key points: ${site.keyPoints.length}`);
        console.log('');
      });
      
      // Агрегированный контент
      if (researchData.aggregatedContent) {
        console.log('\n📑 Aggregated Content:');
        console.log(`  Sources: ${researchData.aggregatedContent.sources.length}`);
        console.log(`  Total words: ${researchData.aggregatedContent.totalWordCount}`);
        console.log(`  Total chars: ${researchData.aggregatedContent.totalCharCount}`);
        console.log(`  Key points: ${researchData.aggregatedContent.allKeyPoints.length}`);
        
        console.log('\n  Content by type:');
        Object.entries(researchData.aggregatedContent.contentByType).forEach(([type, items]) => {
          console.log(`    - ${type}: ${items.length} sources`);
        });
        
        console.log('\n  All key points:');
        researchData.aggregatedContent.allKeyPoints.slice(0, 10).forEach((point, i) => {
          console.log(`    ${i + 1}. ${point.substring(0, 100)}${point.length > 100 ? '...' : ''}`);
        });
      }
      
      // LLM Context
      console.log(`\n📝 LLM Context size: ${researchData.llmContext.length} chars`);
      console.log('\n  Preview (first 500 chars):');
      console.log(researchData.llmContext.substring(0, 500));
    }
    
    // Ошибки
    if (researchData.fetchErrors && researchData.fetchErrors.length > 0) {
      console.log(`\n⚠️  Fetch Errors: ${researchData.fetchErrors.length}`);
      researchData.fetchErrors.slice(0, 5).forEach((err, i) => {
        console.log(`  ${i + 1}. ${err.url}`);
        console.log(`     Error: ${err.error}`);
      });
    }
    
    // Тест генерации
    console.log('\n' + '='.repeat(60));
    console.log('🤖 Testing Content Generation');
    console.log('='.repeat(60));
    
    const generationResult = await webResearch.generateFromResearch(researchData);
    
    if (generationResult) {
      console.log(`\n✅ Generation ready!`);
      console.log(`  Sources: ${JSON.stringify(generationResult.sources)}`);
      console.log(`  Key points for generation: ${generationResult.keyPoints?.length || 0}`);
      console.log(`\n  Prompt preview (first 800 chars):`);
      console.log(generationResult.prompt.substring(0, 800));
      console.log('...');
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('✅ Test completed successfully!');
    console.log('='.repeat(60));
    
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run test
if (require.main === module) {
  const topic = process.argv[2];
  if (topic) {
    console.log(`Testing with topic: ${topic}\n`);
  } else {
    console.log('Usage: node test-content-fetcher.js "Your Topic Here"');
    console.log('Using default topic: Docker best practices\n');
  }
  
  testContentFetcher();
}

module.exports = { testContentFetcher };
