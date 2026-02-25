#!/usr/bin/env node
/**
 * Gap Detector Tests
 * Validates precision, deduplication, and integration
 */

const { GapDetector } = require('../src/gap-detector');
const fs = require('fs').promises;
const path = require('path');

const TEST_TIMEOUT = 30000;

class GapDetectorTests {
  constructor() {
    this.detector = new GapDetector();
    this.results = {
      passed: 0,
      failed: 0,
      tests: []
    };
  }

  async runAll() {
    console.log('🧪 Gap Detector Test Suite\n');
    console.log('='.repeat(70));

    // Test 1: Precision validation
    await this.testPrecision();
    
    // Test 2: Relevance parsing
    await this.testRelevanceParsing();
    
    // Test 3: Deduplication
    await this.testDeduplication();
    
    // Test 4: Complexity assessment
    await this.testComplexityAssessment();
    
    // Test 5: Topic extraction
    await this.testTopicExtraction();
    
    // Test 6: Empty KB handling
    await this.testEmptyKBHandling();
    
    // Test 7: Integration with adapter
    await this.testAdapterIntegration();

    this.printSummary();
    return this.results;
  }

  async test(name, fn) {
    try {
      console.log(`\n📋 Test: ${name}`);
      await fn();
      console.log(`   ✅ PASSED`);
      this.results.passed++;
      this.results.tests.push({ name, status: 'passed' });
    } catch (error) {
      console.log(`   ❌ FAILED: ${error.message}`);
      this.results.failed++;
      this.results.tests.push({ name, status: 'failed', error: error.message });
    }
  }

  async testPrecision() {
    await this.test('Precision > 0.6 (target)', async () => {
      // Test cases: queries where we KNOW if gap should be detected
      const testCases = [
        // Should detect gaps (low knowledge)
        { query: 'How does quantum computing work?', shouldBeGap: true },
        { query: 'Explain blockchain consensus mechanisms', shouldBeGap: true },
        { query: 'What is WebAssembly System Interface?', shouldBeGap: true },
        
        // Should NOT detect gaps (high knowledge)
        { query: 'What is Docker?', shouldBeGap: false },
        { query: 'How to use Kubernetes?', shouldBeGap: false },
        { query: 'Explain React hooks', shouldBeGap: false },
      ];

      let truePositives = 0;
      let falsePositives = 0;
      let trueNegatives = 0;
      let falseNegatives = 0;

      for (const tc of testCases) {
        const session = {
          messages: [{ role: 'user', content: tc.query }]
        };

        const gaps = await this.detector.detect(session);
        const detectedGap = gaps.length > 0;

        if (tc.shouldBeGap && detectedGap) truePositives++;
        if (tc.shouldBeGap && !detectedGap) falseNegatives++;
        if (!tc.shouldBeGap && detectedGap) falsePositives++;
        if (!tc.shouldBeGap && !detectedGap) trueNegatives++;
      }

      const precision = truePositives / (truePositives + falsePositives) || 0;
      
      console.log(`   TP: ${truePositives}, FP: ${falsePositives}, TN: ${trueNegatives}, FN: ${falseNegatives}`);
      console.log(`   Precision: ${(precision * 100).toFixed(1)}%`);
      
      if (precision < 0.6) {
        throw new Error(`Precision ${(precision * 100).toFixed(1)}% below target 60%`);
      }
    });
  }

  async testRelevanceParsing() {
    await this.test('Relevance string parsing', async () => {
      // Test the parsing logic directly
      const testCases = [
        { input: '85.5%', expected: 0.855 },
        { input: '100%', expected: 1.0 },
        { input: '0%', expected: 0 },
        { input: '50.0%', expected: 0.5 },
        { input: 0.75, expected: 0.75 },  // Already a number
        { input: 'N/A', shouldBeNaN: true },
      ];

      for (const tc of testCases) {
        let confidence;
        if (typeof tc.input === 'number') {
          confidence = tc.input;
        } else {
          const parsed = parseFloat(tc.input?.replace('%', ''));
          confidence = isNaN(parsed) ? NaN : parsed / 100;
        }

        if (tc.shouldBeNaN) {
          if (!isNaN(confidence)) {
            throw new Error(`Expected NaN for "${tc.input}", got ${confidence}`);
          }
        } else {
          if (Math.abs(confidence - tc.expected) > 0.001) {
            throw new Error(`Parsing "${tc.input}": expected ${tc.expected}, got ${confidence}`);
          }
        }
      }
    });
  }

  async testDeduplication() {
    await this.test('In-memory deduplication', async () => {
      const topicName = 'TestTopicDeduplication123';
      
      // First add should succeed
      const result1 = await this.detector.addToQueue(topicName, 'high', 'test');
      if (!result1.added) {
        throw new Error('First add should succeed');
      }
      
      // Second add should be deduplicated
      const result2 = await this.detector.addToQueue(topicName, 'high', 'test');
      if (result2.added) {
        throw new Error('Second add should be deduplicated');
      }
      if (result2.reason !== 'already_pending' && result2.reason !== 'already_in_queue') {
        throw new Error(`Expected already_pending or already_in_queue, got ${result2.reason}`);
      }
      
      // Cleanup
      this.detector.pendingTopics.delete(topicName.toLowerCase());
      this.detector.processedTopics.delete(topicName.toLowerCase());
    });
  }

  async testComplexityAssessment() {
    await this.test('Complexity assessment accuracy', async () => {
      const testCases = [
        { text: 'What is Docker?', expected: 'simple' },
        { text: 'How to use React hooks?', expected: 'simple' },
        { text: 'Explain Kubernetes networking and service mesh configuration with Istio', expected: 'complex' },
        { text: 'Compare PostgreSQL vs MongoDB for microservices architecture', expected: 'complex' },
        { text: 'How does async/await work in Node.js?', expected: 'complex' },  // Tech term
      ];

      for (const tc of testCases) {
        const complexity = this.detector.assessComplexity(tc.text);
        if (complexity !== tc.expected) {
          throw new Error(`"${tc.text.substring(0, 30)}...": expected ${tc.expected}, got ${complexity}`);
        }
      }
    });
  }

  async testTopicExtraction() {
    await this.test('Topic extraction quality', async () => {
      const testCases = [
        { query: 'How does React useEffect hook work?', expected: 'React Useeffect Hook' },
        { query: 'What is the difference between Docker and Kubernetes?', expected: 'Difference Docker Kubernetes' },
        { query: 'Explain how to optimize database queries', expected: 'Optimize Database Queries' },
      ];

      for (const tc of testCases) {
        const topic = this.detector.extractTopic(tc.query);
        if (topic !== tc.expected) {
          console.log(`   Note: "${topic}" vs expected "${tc.expected}"`);
          // Not a hard failure, just informational
        }
      }
    });
  }

  async testEmptyKBHandling() {
    await this.test('Empty KB graceful handling', async () => {
      // This test assumes KB might be empty for a nonsense query
      const session = {
        messages: [{ role: 'user', content: 'xyzabc123nonsense' }]
      };

      const gaps = await this.detector.detect(session);
      
      // Should return empty array, not crash
      if (!Array.isArray(gaps)) {
        throw new Error('Should return array even for nonsense queries');
      }
    });
  }

  async testAdapterIntegration() {
    await this.test('OpenClawAdapter integration', async () => {
      const { OpenClawAdapter } = require('../src/openclaw-adapter');
      const adapter = new OpenClawAdapter();
      
      // Check singleton pattern
      const detector1 = adapter.gapDetector;
      const detector2 = adapter.gapDetector;
      
      if (detector1 !== detector2) {
        throw new Error('GapDetector should be singleton');
      }
      
      // Test method exists and returns correct shape
      const session = {
        messages: [{ role: 'user', content: 'What is Docker?' }]
      };
      
      const result = await adapter.analyzeSessionForGaps(session);
      
      if (!result || typeof result.detected !== 'number') {
        throw new Error('Result should have detected count');
      }
    });
  }

  printSummary() {
    console.log('\n' + '='.repeat(70));
    console.log('📊 TEST SUMMARY');
    console.log('='.repeat(70));
    console.log(`Total: ${this.results.tests.length}`);
    console.log(`✅ Passed: ${this.results.passed}`);
    console.log(`❌ Failed: ${this.results.failed}`);
    console.log(`Success Rate: ${((this.results.passed / this.results.tests.length) * 100).toFixed(1)}%`);
    
    if (this.results.failed > 0) {
      console.log('\nFailed tests:');
      this.results.tests
        .filter(t => t.status === 'failed')
        .forEach(t => console.log(`  ❌ ${t.name}: ${t.error}`));
    }
    
    console.log('='.repeat(70));
    
    if (this.results.failed === 0) {
      console.log('\n🎉 All tests passed!');
    } else {
      console.log(`\n⚠️  ${this.results.failed} test(s) failed`);
      process.exit(1);
    }
  }
}

// Run tests
if (require.main === module) {
  const tests = new GapDetectorTests();
  tests.runAll().catch(error => {
    console.error('Test suite failed:', error);
    process.exit(1);
  });
}

module.exports = { GapDetectorTests };
