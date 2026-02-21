/**
 * Skill Challenger
 * Validates skill effectiveness
 */

class SkillChallenger {
  constructor(options = {}) {
    this.skills = new Map();
    this.benchmarks = new Map();
  }

  /**
   * Register skill for monitoring
   */
  registerSkill(skillId, config) {
    this.skills.set(skillId, {
      id: skillId,
      tests: config.tests || [],
      benchmarks: config.benchmarks || {},
      runs: [],
      registered: Date.now()
    });
  }

  /**
   * Run skill validation
   */
  async validate(skillId) {
    const skill = this.skills.get(skillId);
    if (!skill) {
      throw new Error(`Skill ${skillId} not registered`);
    }
    
    const results = {
      skillId,
      timestamp: Date.now(),
      tests: [],
      benchmarks: {},
      overall: 'pending'
    };
    
    // Run tests
    for (const test of skill.tests) {
      try {
        const start = Date.now();
        await test.fn();
        const duration = Date.now() - start;
        
        results.tests.push({
          name: test.name,
          passed: true,
          duration
        });
      } catch (err) {
        results.tests.push({
          name: test.name,
          passed: false,
          error: err.message
        });
      }
    }
    
    // Check benchmarks
    for (const [name, threshold] of Object.entries(skill.benchmarks)) {
      const metric = this.getMetric(skillId, name);
      results.benchmarks[name] = {
        threshold,
        actual: metric,
        passed: metric <= threshold
      };
    }
    
    // Calculate overall
    const allPassed = results.tests.every(t => t.passed) &&
                     Object.values(results.benchmarks).every(b => b.passed);
    results.overall = allPassed ? 'passed' : 'failed';
    
    // Record run
    skill.runs.push(results);
    
    return results;
  }

  /**
   * Record metric for skill
   */
  recordMetric(skillId, name, value) {
    const skill = this.skills.get(skillId);
    if (!skill) return;
    
    if (!skill.metrics) skill.metrics = {};
    if (!skill.metrics[name]) skill.metrics[name] = [];
    
    skill.metrics[name].push({ value, timestamp: Date.now() });
  }

  /**
   * Get metric average
   */
  getMetric(skillId, name) {
    const skill = this.skills.get(skillId);
    if (!skill || !skill.metrics || !skill.metrics[name]) return 0;
    
    const values = skill.metrics[name].map(m => m.value);
    return values.reduce((a, b) => a + b, 0) / values.length;
  }

  /**
   * Get skill effectiveness report
   */
  getReport(skillId) {
    const skill = this.skills.get(skillId);
    if (!skill) return null;
    
    const recentRuns = skill.runs.slice(-10);
    const passRate = recentRuns.filter(r => r.overall === 'passed').length / recentRuns.length || 0;
    
    return {
      skillId,
      totalRuns: skill.runs.length,
      passRate,
      lastRun: skill.runs[skill.runs.length - 1],
      recommendations: this.generateRecommendations(skill, passRate)
    };
  }

  /**
   * Generate improvement recommendations
   */
  generateRecommendations(skill, passRate) {
    const recs = [];
    
    if (passRate < 0.8) {
      recs.push('Increase test coverage');
    }
    
    const failedTests = skill.runs
      .flatMap(r => r.tests)
      .filter(t => !t.passed);
    
    if (failedTests.length > 0) {
      const uniqueErrors = new Set(failedTests.map(t => t.error));
      recs.push(`Fix ${uniqueErrors.size} recurring errors`);
    }
    
    return recs;
  }

  /**
   * Get all skills summary
   */
  getAllReports() {
    const reports = [];
    for (const skillId of this.skills.keys()) {
      reports.push(this.getReport(skillId));
    }
    return reports;
  }
}

module.exports = { SkillChallenger };
