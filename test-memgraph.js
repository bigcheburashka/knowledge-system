// Test Memgraph connection
const neo4j = require('neo4j-driver');

async function test() {
  const driver = neo4j.driver('bolt://localhost:7687', neo4j.auth.basic('', ''));
  const session = driver.session();
  
  try {
    console.log('Testing Memgraph connection...');
    
    // Create test node
    await session.run('CREATE (n:Test {name: $name}) RETURN n', { name: 'TestEntity' });
    console.log('✅ Created test node');
    
    // Count nodes
    const result = await session.run('MATCH (n) RETURN count(n) as count');
    const count = result.records[0].get('count').toNumber();
    console.log(`📊 Total nodes: ${count}`);
    
    // Delete test node
    await session.run('MATCH (n:Test) DELETE n');
    console.log('✅ Cleaned up test node');
    
  } catch (e) {
    console.error('❌ Error:', e.message);
  } finally {
    await session.close();
    await driver.close();
  }
}

test();
