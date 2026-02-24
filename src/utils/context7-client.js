/**
 * Context7 MCP Client
 * Клиент для получения актуальной документации через Context7
 */

const axios = require('axios');

class Context7Client {
  constructor(options = {}) {
    this.apiToken = options.apiToken || process.env.CONTEXT7_API_TOKEN;
    this.baseUrl = 'https://api.context7.com/v1';
  }

  /**
   * Query documentation for a specific topic
   * @param {Object} params - Query parameters
   * @param {string} params.topic - Topic name (e.g., 'docker', 'react')
   * @param {string} params.query - Specific query
   * @param {string} params.version - Version (optional)
   * @returns {Promise<Array>} - Documentation results
   */
  async query({ topic, query, version }) {
    try {
      const headers = {};
      if (this.apiToken) {
        headers['Authorization'] = `Bearer ${this.apiToken}`;
      }

      const response = await axios.post(`${this.baseUrl}/query`, {
        topic,
        query,
        version,
        limit: 10
      }, {
        headers,
        timeout: 15000
      });

      return response.data.results || [];
    } catch (error) {
      console.warn('[Context7] Query failed:', error.message);
      return [];
    }
  }

  /**
   * Get best practices for a technology
   */
  async getBestPractices(technology) {
    return this.query({
      topic: technology,
      query: 'best practices 2024'
    });
  }

  /**
   * Get code examples
   */
  async getExamples(technology, specificTopic) {
    return this.query({
      topic: technology,
      query: `examples ${specificTopic}`
    });
  }

  /**
   * Check if Context7 is available
   */
  async isAvailable() {
    try {
      await axios.get(`${this.baseUrl}/health`, { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }
}

module.exports = { Context7Client };
