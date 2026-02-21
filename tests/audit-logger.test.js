/**
 * Tests for Audit Logger
 */

const { AuditLogger } = require('../src/evolution/audit-logger');
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
  console.log('\n=== Audit Logger Tests ===\n');
  
  const basePath = '/tmp/test-audit-' + Date.now();
  let audit;
  let passed = 0;
  let failed = 0;
  
  // Setup
  try {
    await fs.mkdir(basePath, { recursive: true });
    await fs.mkdir(path.join(basePath, 'logs'), { recursive: true });
    
    audit = new AuditLogger({ basePath });
    await audit.init();
  } catch (err) {
    console.error('Setup failed:', err);
    process.exit(1);
  }
  
  // Test 1: Initialize
  if (await test('Initialize audit logger', async () => {
    if (!audit.auditLogPath) throw new Error('Audit log path not set');
  })) passed++; else failed++;
  
  // Test 2: Log generic event
  if (await test('Log generic event', async () => {
    await audit.log({ type: 'TEST_EVENT', data: 'test' });
    
    const content = await fs.readFile(audit.auditLogPath, 'utf8');
    const entries = content.trim().split('\n');
    const entry = JSON.parse(entries[0]);
    
    if (entry.type !== 'TEST_EVENT') throw new Error('Event not logged');
    if (!entry.timestamp) throw new Error('Missing timestamp');
  })) passed++; else failed++;
  
  // Test 3: Log proposal
  if (await test('Log proposal creation', async () => {
    await audit.logProposal({
      id: 'prop-123',
      level: 'L2',
      type: 'new_skill',
      change: { reason: 'Test' }
    });
    
    const content = await fs.readFile(audit.auditLogPath, 'utf8');
    if (!content.includes('PROPOSAL_CREATED')) throw new Error('Proposal not logged');
  })) passed++; else failed++;
  
  // Test 4: Log approval
  if (await test('Log approval', async () => {
    await audit.logApproval('prop-123', 'telegram', 'L2');
    
    const content = await fs.readFile(audit.auditLogPath, 'utf8');
    if (!content.includes('PROPOSAL_APPROVED')) throw new Error('Approval not logged');
  })) passed++; else failed++;
  
  // Test 5: Log rejection
  if (await test('Log rejection', async () => {
    await audit.logRejection('prop-123', 'Not needed', 'user');
    
    const content = await fs.readFile(audit.auditLogPath, 'utf8');
    if (!content.includes('PROPOSAL_REJECTED')) throw new Error('Rejection not logged');
  })) passed++; else failed++;
  
  // Test 6: Query audit log
  if (await test('Query audit log', async () => {
    await audit.log({ type: 'QUERY_TEST', id: '123' });
    
    const results = await audit.query({ type: 'QUERY_TEST' });
    if (!Array.isArray(results)) throw new Error('Query failed');
    if (results.length === 0) throw new Error('No results');
  })) passed++; else failed++;
  
  // Test 7: Get proposal trail
  if (await test('Get proposal trail', async () => {
    const trail = await audit.getProposalTrail('prop-123');
    if (!Array.isArray(trail)) throw new Error('Trail not returned');
    // Should have PROPOSAL_CREATED, PROPOSAL_APPROVED
    if (trail.length < 2) throw new Error('Incomplete trail');
  })) passed++; else failed++;
  
  // Test 8: Cleanup old logs
  if (await test('Cleanup old rotated logs', async () => {
    // Create a fake old rotated log
    const oldLog = path.join(basePath, 'logs', 'audit.log.2020-01-01T00-00-00Z');
    await fs.writeFile(oldLog, 'old');
    
    const result = await audit.cleanup(0); // 0 days = clean everything
    if (result.cleaned !== 1) throw new Error('Old log not cleaned');
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
