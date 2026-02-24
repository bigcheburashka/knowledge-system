/**
 * Web Research Module
 * Поиск и анализ веб-источников для Deep Learning
 */

const axios = require('axios');
const cheerio = require('cheerio');
const { execSync } = require('child_process');

class WebResearch {
  constructor() {
    this.braveApiKey = process.env.BRAVE_API_KEY;
    this.ddgFallback = true;
  }

  /**
   * Search with Brave API + DuckDuckGo fallback
   * Возвращает топ-20 результатов
   */
  async search(query, options = {}) {
    const limit = options.limit || 20;
    let results = [];

    // Try Brave first
    if (this.braveApiKey) {
      try {
        results = await this.searchBrave(query, limit);
        console.log(`[WebResearch] Brave: ${results.length} results for "${query}"`);
      } catch (e) {
        console.warn('[WebResearch] Brave failed:', e.message);
      }
    }

    // Fallback to DuckDuckGo
    if (results.length < limit && this.ddgFallback) {
      try {
        const ddgResults = await this.searchDuckDuckGo(query, limit - results.length);
        results = results.concat(ddgResults);
        console.log(`[WebResearch] DDG: ${ddgResults.length} additional results`);
      } catch (e) {
        console.warn('[WebResearch] DDG failed:', e.message);
      }
    }

    return results.slice(0, limit);
  }

  /**
   * Brave Search API
   */
  async searchBrave(query, limit = 20) {
    const response = await axios.get('https://api.search.brave.com/res/v1/web/search', {
      headers: {
        'X-Subscription-Token': this.braveApiKey,
        'Accept': 'application/json'
      },
      params: {
        q: query,
        count: limit,
        offset: 0,
        mkt: 'en-US',
        safesearch: 'off',
        freshness: 'py' // Past year
      },
      timeout: 15000
    });

    return response.data.web?.results?.map(r => ({
      title: r.title,
      url: r.url,
      description: r.description,
      source: 'brave',
      age: r.age,
      page_age: r.page_age
    })) || [];
  }

  /**
   * DuckDuckGo fallback (using duckduckgo-lite)
   */
  async searchDuckDuckGo(query, limit = 20) {
    // Use ddgr CLI tool or scrape HTML
    try {
      const cmd = `ddgr --np --json "${query.replace(/"/g, '\\"')}" 2>/dev/null | head -${limit}`;
      const output = execSync(cmd, { encoding: 'utf8', timeout: 30000 });
      
      const results = [];
      const lines = output.trim().split('\n').filter(l => l);
      
      for (const line of lines) {
        try {
          const data = JSON.parse(line);
          results.push({
            title: data.title,
            url: data.url,
            description: data.abstract,
            source: 'ddg'
          });
        } catch {}
      }
      
      return results;
    } catch {
      // If ddgr not available, return empty
      return [];
    }
  }

  /**
   * Fetch and parse webpage content
   */
  async fetchPage(url, options = {}) {
    try {
      const response = await axios.get(url, {
        timeout: options.timeout || 10000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; KnowledgeBot/1.0)',
          'Accept': 'text/html,application/xhtml+xml'
        },
        maxRedirects: 3
      });

      const $ = cheerio.load(response.data);
      
      // Remove script/style/nav/footer
      $('script, style, nav, footer, header, aside, .ads, .cookie-banner').remove();
      
      // Extract main content
      let content = '';
      
      // Try to find main content area
      const mainSelectors = [
        'main',
        'article',
        '[role="main"]',
        '.content',
        '.documentation',
        '#content',
        '.main-content'
      ];
      
      for (const selector of mainSelectors) {
        const text = $(selector).text().trim();
        if (text.length > 500) {
          content = text;
          break;
        }
      }
      
      // Fallback to body
      if (!content) {
        content = $('body').text().trim();
      }
      
      // Clean up
      content = content
        .replace(/\s+/g, ' ')
        .replace(/\n+/g, '\n')
        .substring(0, 15000); // Limit to 15k chars

      return {
        url,
        title: $('title').text().trim() || url,
        content,
        length: content.length
      };
    } catch (error) {
      console.warn(`[WebResearch] Failed to fetch ${url}:`, error.message);
      return null;
    }
  }

  /**
   * Search GitHub repositories
   * Топ-20 репозиториев
   */
  async searchGitHub(query, limit = 20) {
    const searchQuery = `${query} stars:>100 language:JavaScript OR language:TypeScript OR language:Python`;
    
    try {
      const response = await axios.get('https://api.github.com/search/repositories', {
        headers: process.env.GITHUB_TOKEN ? {
          'Authorization': `token ${process.env.GITHUB_TOKEN}`
        } : {},
        params: {
          q: searchQuery,
          sort: 'stars',
          order: 'desc',
          per_page: limit
        },
        timeout: 15000
      });

      return response.data.items?.map(repo => ({
        name: repo.name,
        fullName: repo.full_name,
        url: repo.html_url,
        description: repo.description,
        stars: repo.stargazers_count,
        language: repo.language,
        topics: repo.topics || [],
        source: 'github'
      })) || [];
    } catch (error) {
      console.warn('[WebResearch] GitHub search failed:', error.message);
      return [];
    }
  }

  /**
   * Analyze GitHub repository structure
   */
  async analyzeRepo(fullName) {
    try {
      // Get README
      const readmeResponse = await axios.get(
        `https://api.github.com/repos/${fullName}/readme`,
        {
          headers: process.env.GITHUB_TOKEN ? {
            'Authorization': `token ${process.env.GITHUB_TOKEN}`
          } : {},
          timeout: 10000
        }
      );
      
      const readme = Buffer.from(readmeResponse.data.content, 'base64').toString('utf8');
      
      // Get repo info
      const infoResponse = await axios.get(
        `https://api.github.com/repos/${fullName}`,
        {
          headers: process.env.GITHUB_TOKEN ? {
            'Authorization': `token ${process.env.GITHUB_TOKEN}`
          } : {},
          timeout: 10000
        }
      );

      return {
        fullName,
        readme: readme.substring(0, 10000),
        description: infoResponse.data.description,
        stars: infoResponse.data.stargazers_count,
        language: infoResponse.data.language,
        topics: infoResponse.data.topics || [],
        hasWiki: infoResponse.data.has_wiki,
        hasPages: infoResponse.data.has_pages
      };
    } catch (error) {
      console.warn(`[WebResearch] Failed to analyze ${fullName}:`, error.message);
      return null;
    }
  }

  /**
   * Find official documentation URL
   */
  async findDocumentation(technology) {
    const commonPatterns = [
      `https://docs.${technology.toLowerCase()}.io`,
      `https://docs.${technology.toLowerCase()}.com`,
      `https://${technology.toLowerCase()}.dev/docs`,
      `https://${technology.toLowerCase()}.org/docs`,
      `https://docs.${technology.toLowerCase()}.dev`,
      `https://www.${technology.toLowerCase()}.com/docs`,
      `https://doc.${technology.toLowerCase()}.org`,
      `https://developer.${technology.toLowerCase()}.org`
    ];

    for (const url of commonPatterns) {
      try {
        const response = await axios.head(url, {
          timeout: 5000,
          maxRedirects: 2,
          validateStatus: status => status < 400
        });
        
        if (response.status < 400) {
          return url;
        }
      } catch {
        // Try next
      }
    }

    return null;
  }

  /**
   * Research topic comprehensively
   */
  async researchTopic(topicName, options = {}) {
    console.log(`[WebResearch] Researching: ${topicName}`);
    
    const results = {
      searchResults: [],
      githubRepos: [],
      documentation: null,
      analyzedContent: []
    };

    // 1. Web search (top 20)
    results.searchResults = await this.search(topicName, { limit: 20 });

    // 2. GitHub repos (top 20)
    results.githubRepos = await this.searchGitHub(topicName, 20);

    // 3. Find documentation
    results.documentation = await this.findDocumentation(topicName);

    // 4. Fetch top 5 pages for analysis
    if (options.fetchContent !== false) {
      const pagesToFetch = results.searchResults.slice(0, 5);
      
      for (const page of pagesToFetch) {
        const content = await this.fetchPage(page.url);
        if (content) {
          results.analyzedContent.push(content);
        }
      }

      // Also fetch docs if found
      if (results.documentation) {
        const docs = await this.fetchPage(results.documentation);
        if (docs) {
          results.analyzedContent.push(docs);
        }
      }
    }

    console.log(`[WebResearch] Complete: ${results.searchResults.length} web, ${results.githubRepos.length} repos, ${results.analyzedContent.length} pages fetched`);
    
    return results;
  }
}

module.exports = { WebResearch };
