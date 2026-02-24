#!/usr/bin/env python3
"""
DuckDuckGo Search via Python
Альтернативная реализация поиска через Python-библиотеку
"""

import sys
import json
from duckduckgo_search import DDGS

def search(query, max_results=20):
    """Search DuckDuckGo and return JSON results"""
    try:
        with DDGS() as ddgs:
            results = []
            for r in ddgs.text(query, max_results=max_results):
                results.append({
                    'title': r.get('title', ''),
                    'url': r.get('href', ''),
                    'description': r.get('body', ''),
                    'source': 'ddg-python'
                })
            
            return {
                'success': True,
                'query': query,
                'results': results,
                'count': len(results)
            }
    except Exception as e:
        return {
            'success': False,
            'error': str(e),
            'query': query,
            'results': []
        }

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(json.dumps({'error': 'No query provided'}))
        sys.exit(1)
    
    query = sys.argv[1]
    max_results = int(sys.argv[2]) if len(sys.argv) > 2 else 20
    
    result = search(query, max_results)
    print(json.dumps(result, ensure_ascii=False))
