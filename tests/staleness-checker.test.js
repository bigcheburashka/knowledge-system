/**
 * Tests for Staleness Checker
 */

const { StalenessChecker } = require('../src/evolution/staleness-checker');
const fs = require('fs').promises;
const path = require('path');

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    return true;
  } catch (err) {
    console.log(`  ❌ ${name}: ${err.message}`);
    return false;
  }
}

async function runTests() {
  console.log('\n=== Staleness Checker Tests ===\n');
  
  const basePath = '/tmp/test-staleness-' + Date.now();
  let checker;
  let passed = 0;
  let failed = 0;
  
  // Setup
  try {
    await fs.mkdir(basePath, { recursive: true });
    await fs.mkdir(path.join(basePath, 'logs'), { recursive: true });
    await fs.mkdir(path.join(basePath, 'queue'), { recursive: true });
    
    checker = new StalenessChecker({ basePath });
    await checker.init();
  } catch (err) {
    console.error('Setup failed:', err);
    process.exit(1);
  }
  
  // Test 1: Initialize
  if (await test('Initialize staleness checker', async () => {
    if (!checker.log) throw new Error('Log not initialized');
    if (!checker.audit) throw new Error('Audit not initialized');
    if (checker.warningThreshold !== 60) throw new Error('Wrong warning threshold');
    if (checker.criticalThreshold !== 90) throw new Error('Wrong critical threshold');
  })) passed++; else failed++;
  
  // Test 2: Thresholds
  if (await test('Threshold configuration', async () => {
    const customChecker = new StalenessChecker({
      basePath,
      warningThreshold: 30,
      criticalThreshold: 60
    });
    
    if (customChecker.warningThreshold !== 30) throw new Error('Warning not set');
    if (customChecker.criticalThreshold !== 60) throw new Error('Critical not set');
  })) passed++; else failed++;
  
  // Test 3: Run check (without actual DB)
  if (await test('Run staleness check', async () => {
    const result = await checker.run();
    
    if (typeof result.checked !== 'number') throw new Error('Missing checked count');
    if (typeof result.warning !== 'object') throw new Error('Missing warning array');
    if (typeof result.critical !== 'object') throw new Error('Missing critical array');
    if (typeof result.proposed !== 'number') throw new Error('Missing proposed count');
    if (!result.timestamp) throw new Error('Missing timestamp');
  })) passed++; else failed++;
  
  // Test 4: Generate report
  if (await test('Generate report', async () => {
    const report = await checker.generateReport();
    
    if (!report.generatedAt) throw new Error('Missing generatedAt');
    if (!report.summary) throw new Error('Missing summary');
    if (typeof report.summary.totalChecked !== 'number') throw new Error('Missing totalChecked');
    if (!Array.isArray(report.recommendations)) throw new Error('Missing recommendations');
  })) passed++; else failed++;
  
  // Test 5: Age calculation
  if (await test('Age calculation logic', async () => {
    const now = Date.now();
    const days30 = now - 30 * 24 * 60 * 60 * 1000;
    const days100 = now - 100 * 24 * 60 * 60 * 1000;
    
    // 30 days should NOT be warning (threshold 60)
    const age30 = (now - days30) / (1000 * 60 * 60 * 24);
    if (age30 > 60) throw new Error('Age calculation wrong for 30 days');
    
    // 100 days should be critical (threshold 90)
    const age100 = (now - days100) / (1000 * 60 * 60 * 24);
    if (age100 < 90) throw new Error('Age calculation wrong for 100 days');
  })) passed++; else failed++;
  
  // Cleanup
  try {
    await fs.rm(basePath, { recursive: true, force: true });
  } catch {}
  
  // Summary
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
  
  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
