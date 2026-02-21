/**
 * Three-Layer Graph Schema Setup
 * Creates constraints and indexes in Memgraph
 */

const neo4j = require('neo4j-driver');

class GraphSchema {
  constructor(config = {}) {
    this.driver = neo4j.driver(
      config.uri || 'bolt://localhost:7687',
      neo4j.auth.basic(
        config.user || 'memgraph',
        config.password || 'memgraph'
      )
    );
  }

  async setup() {
    const session = this.driver.session();
    
    try {
      console.log('[GraphSchema] Setting up three-layer schema...');
      
      // CODE LAYER
      console.log('[GraphSchema] Creating Code Layer constraints...');
      await session.run(`
        CREATE CONSTRAINT ON (s:Skill) ASSERT s.id IS UNIQUE;
      `);
      await session.run(`
        CREATE CONSTRAINT ON (t:Tool) ASSERT t.id IS UNIQUE;
      `);
      await session.run(`
        CREATE INDEX ON :Skill(name);
      `);
      await session.run(`
        CREATE INDEX ON :Tool(name);
      `);
      
      // LOG LAYER
      console.log('[GraphSchema] Creating Log Layer constraints...');
      await session.run(`
        CREATE CONSTRAINT ON (d:Decision) ASSERT d.id IS UNIQUE;
      `);
      await session.run(`
        CREATE CONSTRAINT ON (c:Checkpoint) ASSERT c.id IS UNIQUE;
      `);
      await session.run(`
        CREATE CONSTRAINT ON (r:Reflection) ASSERT r.id IS UNIQUE;
      `);
      await session.run(`
        CREATE INDEX ON :Decision(timestamp);
      `);
      await session.run(`
        CREATE INDEX ON :Decision(agent);
      `);
      await session.run(`
        CREATE INDEX ON :Checkpoint(status);
      `);
      
      // KNOWLEDGE LAYER
      console.log('[GraphSchema] Creating Knowledge Layer constraints...');
      await session.run(`
        CREATE CONSTRAINT ON (k:Knowledge) ASSERT k.id IS UNIQUE;
      `);
      await session.run(`
        CREATE CONSTRAINT ON (c:Concept) ASSERT c.name IS UNIQUE;
      `);
      await session.run(`
        CREATE INDEX ON :Knowledge(topic);
      `);
      await session.run(`
        CREATE INDEX ON :Concept(category);
      `);
      
      // META LAYER (for self-improvement)
      console.log('[GraphSchema] Creating Meta Layer constraints...');
      await session.run(`
        CREATE CONSTRAINT ON (m:MetaDecision) ASSERT m.id IS UNIQUE;
      `);
      await session.run(`
        CREATE INDEX ON :MetaDecision(timestamp);
      `);
      
      console.log('[GraphSchema] Schema setup complete!');
      
    } catch (err) {
      console.error('[GraphSchema] Error:', err.message);
      throw err;
    } finally {
      await session.close();
    }
  }

  async verify() {
    const session = this.driver.session();
    
    try {
      console.log('[GraphSchema] Verifying schema...');
      
      // Count constraints
      const constraints = await session.run(`
        SHOW CONSTRAINT INFO;
      `);
      console.log('  Constraints:', constraints.records.length);
      
      // Count indexes
      const indexes = await session.run(`
        SHOW INDEX INFO;
      `);
      console.log('  Indexes:', indexes.records.length);
      
      // Test node creation
      await session.run(`
        CREATE (test:Skill {id: 'test', name: 'TestSkill'});
      `);
      
      const test = await session.run(`
        MATCH (s:Skill {id: 'test'}) RETURN s.name;
      `);
      
      if (test.records.length === 1) {
        console.log('  ✓ Node creation works');
      }
      
      // Cleanup test
      await session.run(`
        MATCH (test:Skill {id: 'test'}) DELETE test;
      `);
      
      console.log('[GraphSchema] Verification complete!');
      
    } catch (err) {
      console.error('[GraphSchema] Verification failed:', err.message);
      throw err;
    } finally {
      await session.close();
    }
  }

  async close() {
    await this.driver.close();
  }
}

// CLI usage
if (require.main === module) {
  async function main() {
    const schema = new GraphSchema();
    
    try {
      await schema.setup();
      await schema.verify();
      console.log('\n✅ Graph schema ready!');
      process.exit(0);
    } catch (err) {
      console.error('\n❌ Schema setup failed:', err.message);
      process.exit(1);
    } finally {
      await schema.close();
    }
  }
  
  main();
}

module.exports = { GraphSchema };
