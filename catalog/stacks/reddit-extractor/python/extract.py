#!/usr/bin/env python3
"""Reddit Extractor Tool"""
import sys
import json

def main():
    try:
        input_data = json.loads(sys.stdin.read())
    except json.JSONDecodeError:
        print(json.dumps({"success": False, "error": "Invalid JSON input"}))
        sys.exit(1)
    
    url = input_data.get('url')
    max_comments = input_data.get('max_comments', 100)
    
    if not url:
        print(json.dumps({"success": False, "error": "url is required"}))
        sys.exit(1)
    
    result = {
        "success": True,
        "outputs": {
            "json_path": "reddit_data.json"
        },
        "message": f"Would extract {max_comments} comments from {url} (demo mode)"
    }
    
    print(json.dumps(result))
    sys.exit(0)

if __name__ == '__main__':
    main()
