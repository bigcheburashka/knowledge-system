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
   * Search with DuckDuckGo as primary, Brave as fallback
   * Возвращает топ-20 результатов
   */
  async search(query, options = {}) {
    const limit = options.limit || 20;
    let results = [];

    // Try DuckDuckGo first (primary)
    try {
      results = await this.searchDuckDuckGo(query, limit);
      console.log(`[WebResearch] DDG: ${results.length} results for "${query}"`);
    } catch (e) {
      console.warn('[WebResearch] DDG failed:', e.message);
    }

    // Fallback to Brave if DDG failed and Brave key available
    if (results.length < limit / 2 && this.braveApiKey) {
      try {
        const braveResults = await this.searchBrave(query, limit - results.length);
        results = results.concat(braveResults);
        console.log(`[WebResearch] Brave: ${braveResults.length} additional results`);
      } catch (e) {
        console.warn('[WebResearch] Brave failed:', e.message);
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
   * Collect research data only (no generation)
   * Сбор данных без генерации контента
   */
  async collectResearchData(topicName, options = {}) {
    console.log(`[WebResearch] Collecting data for: ${topicName}`);
    
    const results = {
      topic: topicName,
      searchResults: [],
      githubRepos: [],
      documentation: null,
      fetchedPages: [],
      collectedAt: new Date().toISOString()
    };

    // 1. Web search (top 20)
    if (options.webSearch !== false) {
      results.searchResults = await this.search(topicName, { limit: 20 });
      console.log(`[WebResearch]  - Web: ${results.searchResults.length} results`);
    }

    // 2. GitHub repos (top 20)
    if (options.githubSearch !== false) {
      results.githubRepos = await this.searchGitHub(topicName, 20);
      console.log(`[WebResearch]  - GitHub: ${results.githubRepos.length} repos`);
    }

    // 3. Find documentation
    if (options.findDocs !== false) {
      results.documentation = await this.findDocumentation(topicName);
      console.log(`[WebResearch]  - Docs: ${results.documentation || 'not found'}`);
    }

    // 4. Fetch top pages for raw content
    if (options.fetchContent !== false) {
      const pagesToFetch = results.searchResults.slice(0, 5);
      for (const page of pagesToFetch) {
        const content = await this.fetchPage(page.url);
        if (content) {
          results.fetchedPages.push({
            url: content.url,
            title: content.title,
            content: content.content.substring(0, 5000), // Limit to 5k chars
            fetchedAt: new Date().toISOString()
          });
        }
      }
      console.log(`[WebResearch]  - Fetched pages: ${results.fetchedPages.length}`);
    }

    console.log(`[WebResearch] Collection complete for: ${topicName}`);
    return results;
  }

  /**
   * Generate content using collected research data
   * Генерация контента на основе собранных данных (для 2-hop)
   */
  async generateFromResearch(researchData, options = {}) {
    console.log(`[WebResearch] Generating content from research for: ${researchData.topic}`);
    
    // Only generate if we have research data
    if (!researchData || researchData.fetchedPages.length === 0) {
      console.log(`[WebResearch] No research data, skipping generation`);
      return null;
    }

    // Prepare context from research
    const webContext = researchData.fetchedPages
      .map(p => `Source: ${p.url}\nTitle: ${p.title}\nContent: ${p.content.substring(0, 2000)}`)
      .join('\n\n---\n\n');
    
    const githubContext = researchData.githubRepos
      .slice(0, 5)
      .map(r => `Repo: ${r.fullName} (${r.stars}⭐)\nDescription: ${r.description}`)
      .join('\n');

    // Build generation prompt
    const prompt = `Based on the following research data about "${researchData.topic}", generate comprehensive knowledge:

WEB SOURCES:
${webContext.substring(0, 10000)}

GITHUB REPOSITORIES:
${githubContext}

OFFICIAL DOCUMENTATION: ${researchData.documentation || 'N/A'}

Generate structured content with:
1. Detailed description
2. Best practices (8-10 items)
3. Common mistakes (6-8 items)
4. Tools and ecosystem (8-10 items)
5. Deployment considerations
6. Current trends

Use only factual information from sources.`;

    // This would be called from deep-learning.js with LLM
    return {
      prompt,
      sources: {
        web: researchData.searchResults.length,
        github: researchData.githubRepos.length,
        pages: researchData.fetchedPages.length
      }
    };
  }
}

module.exports = { WebResearch };
