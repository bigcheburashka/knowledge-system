#!/usr/bin/env node
/**
 * Test Web Research Module
 */

const { WebResearch } = require('./src/evolution/web-research');

async function main() {
  console.log('=== TESTING WEB RESEARCH ===\n');
  
  const webResearch = new WebResearch();
  
  // Test topic
  const topic = 'Kubernetes Best Practices';
  
  console.log(`Testing research for: ${topic}\n`);
  
  try {
    const results = await webResearch.researchTopic(topic, {
      fetchContent: true
    });
    
    console.log('\n📊 RESULTS:');
    console.log(`Web results: ${results.searchResults.length}`);
    console.log(`GitHub repos: ${results.githubRepos.length}`);
    console.log(`Fetched pages: ${results.analyzedContent.length}`);
    console.log(`Documentation: ${results.documentation || 'Not found'}`);
    
    console.log('\n🔍 Top 5 Web Results:');
    results.searchResults.slice(0, 5).forEach((r, i) => {
      console.log(`${i+1}. ${r.title}`);
      console.log(`   URL: ${r.url}`);
      console.log(`   Source: ${r.source}`);
      console.log();
    });
    
    console.log('🔝 Top 5 GitHub Repos:');
    results.githubRepos.slice(0, 5).forEach((r, i) => {
      console.log(`${i+1}. ${r.fullName} (${r.stars}⭐)`);
      console.log(`   ${r.description?.substring(0, 100)}...`);
      console.log();
    });
    
    if (results.analyzedContent.length > 0) {
      console.log('📄 Sample Content (first page):');
      const first = results.analyzedContent[0];
      console.log(`Title: ${first.title}`);
      console.log(`Content preview: ${first.content.substring(0, 500)}...`);
    }
    
  } catch (error) {
    console.error('Error:', error.message);
    console.error(error.stack);
  }
}

main();
