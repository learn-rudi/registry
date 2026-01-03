---
name: reddit-extractor
description: Extract posts and comments from Reddit threads
---

# Reddit Extractor

Extract structured data from Reddit threads including post content, comments, metadata, and engagement metrics. Perfect for research, content analysis, and data collection.

## Features

- Extract post title, body, and metadata
- Pull top-level comments and replies
- Configurable comment limits
- Outputs clean JSON format
- Preserves comment hierarchy and timestamps

## Usage

### Extract Thread

```bash
spacely run reddit-extractor --url "https://www.reddit.com/r/programming/comments/..."
```

### Limit Comments

```bash
spacely run reddit-extractor --url "https://reddit.com/r/AskReddit/..." --max_comments 50
```

## Input Parameters

**Required:**
- `url`: Full Reddit thread URL

**Optional:**
- `max_comments`: Maximum number of comments to extract (default: 100)

## Output

Generates a JSON file containing:
- Post title, body, author, score, timestamp
- Top comments with author, text, score
- Reply threads and comment metadata
- Subreddit information

## Common Use Cases

- Market research and sentiment analysis
- Content aggregation for newsletters
- Academic research on online discussions
- Community feedback collection
- Trend analysis and monitoring

## Dependencies

Requires Python packages: `praw` (Python Reddit API Wrapper), `requests`
