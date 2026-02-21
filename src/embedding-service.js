// Embedding Service - OpenAI (Primary) + Hugging Face (Fallback)
const axios = require('axios');
require('dotenv').config({ path: '/root/.openclaw/workspace/knowledge-system/.env' });

// OpenAI config
const OPENAI_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.EMBEDDING_MODEL_PRIMARY || 'text-embedding-3-small';

// Hugging Face config (updated endpoint)
const HF_KEY = process.env.HF_API_KEY;
const HF_MODEL = process.env.EMBEDDING_MODEL_FALLBACK || 'BAAI/bge-base-en-v1.5';
// Updated HF Inference API endpoint
const HF_URL = `https://router.huggingface.co/hf-inference/models/${HF_MODEL}`;

const RATE_LIMIT_MS = parseInt(process.env.RATE_LIMIT_MS) || 2000;

console.log('✅ Embedding service initialized');
console.log(`   Primary: OpenAI ${OPENAI_MODEL}`);
console.log(`   Fallback: Hugging Face ${HF_MODEL}`);

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// OpenAI embedding
async function getOpenAIEmbedding(text, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await axios.post(
        'https://api.openai.com/v1/embeddings',
        {
          input: text.substring(0, 8000),
          model: OPENAI_MODEL
        },
        {
          headers: {
            'Authorization': `Bearer ${OPENAI_KEY}`,
            'Content-Type': 'application/json'
          },
          timeout: 30000
        }
      );
      return response.data.data[0].embedding;
    } catch (e) {
      const status = e.response?.status;
      if (status === 429 && attempt < retries) {
        const delay = Math.min(3000 * Math.pow(2, attempt - 1), 30000);
        console.log(`   OpenAI rate limit, retrying in ${delay/1000}s...`);
        await sleep(delay);
        continue;
      }
      throw e;
    }
  }
  throw new Error('OpenAI max retries exceeded');
}

// Hugging Face embedding (updated endpoint)
async function getHFEmbedding(text, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await axios.post(
        HF_URL,
        { inputs: text.substring(0, 1000) },
        {
          headers: {
            'Authorization': `Bearer ${HF_KEY}`,
            'Content-Type': 'application/json'
          },
          timeout: 60000
        }
      );

      const embedding = Array.isArray(response.data[0]) ? response.data[0] : response.data;
      if (!Array.isArray(embedding)) {
        throw new Error('Invalid HF response format');
      }
      return embedding;
    } catch (e) {
      const status = e.response?.status;
      const errorMsg = e.response?.data?.error || e.message;
      
      if ((status === 429 || status === 503 || status === 500) && attempt < retries) {
        const delay = attempt * 5000;
        console.log(`   HF loading (${errorMsg}), retrying in ${delay/1000}s...`);
        await sleep(delay);
        continue;
      }
      throw e;
    }
  }
  throw new Error('HF max retries exceeded');
}

// Primary: OpenAI, Fallback: HF
async function getEmbedding(text) {
  if (!text || text.trim().length === 0) {
    throw new Error('Empty text provided');
  }

  // Try OpenAI first
  try {
    return await getOpenAIEmbedding(text);
  } catch (e) {
    console.log(`⚠️  OpenAI failed: ${e.message}, trying HF fallback...`);
    
    // Fallback to HF
    try {
      return await getHFEmbedding(text);
    } catch (hfError) {
      console.error(`❌ HF fallback also failed: ${hfError.message}`);
      throw new Error('Both primary and fallback embedding services failed');
    }
  }
}

async function getEmbeddingsBatch(texts, onProgress) {
  const embeddings = [];
  
  for (let i = 0; i < texts.length; i++) {
    try {
      const emb = await getEmbedding(texts[i]);
      embeddings.push(emb);
      
      if (onProgress) {
        onProgress(i + 1, texts.length);
      }
      
      if (i < texts.length - 1) {
        await sleep(RATE_LIMIT_MS);
      }
    } catch (e) {
      console.error(`Error embedding [${i}]: ${e.message}`);
      embeddings.push(null);
    }
  }
  
  return embeddings;
}

async function test() {
  console.log('\n🧪 Testing embedding service with fallback...');
  const testText = "Node.js JavaScript runtime";
  
  try {
    const embedding = await getEmbedding(testText);
    console.log(`✅ Generated embedding: ${embedding.length} dimensions`);
    console.log(`   Sample: [${embedding.slice(0, 3).map(v => v.toFixed(4)).join(', ')}...]`);
    
    const provider = embedding.length === 1536 ? 'OpenAI' : 'Hugging Face';
    console.log(`   Provider: ${provider}`);
    return true;
  } catch (e) {
    console.error('❌ Test failed:', e.message);
    return false;
  }
}

async function testHF() {
  console.log('\n🧪 Testing Hugging Face directly...');
  const testText = "Docker containerization platform";
  
  try {
    const embedding = await getHFEmbedding(testText);
    console.log(`✅ HF embedding: ${embedding.length} dimensions`);
    console.log(`   Sample: [${embedding.slice(0, 3).map(v => v.toFixed(4)).join(', ')}...]`);
    return true;
  } catch (e) {
    console.error('❌ HF test failed:', e.message);
    if (e.response) {
      console.error('   Response:', JSON.stringify(e.response.data, null, 2).substring(0, 200));
    }
    return false;
  }
}

if (require.main === module) {
  (async () => {
    console.log('=' .repeat(50));
    const openaiOk = await test();
    console.log('=' .repeat(50));
    const hfOk = await testHF();
    console.log('=' .repeat(50));
    
    if (openaiOk && hfOk) {
      console.log('\n✅ Both providers working!');
    } else if (openaiOk) {
      console.log('\n✅ OpenAI working (primary), HF has issues (will retry on fallback)');
    } else {
      console.log('\n❌ Critical: No working embedding provider');
      process.exit(1);
    }
  })();
}

module.exports = { getEmbedding, getEmbeddingsBatch, sleep, getOpenAIEmbedding, getHFEmbedding };