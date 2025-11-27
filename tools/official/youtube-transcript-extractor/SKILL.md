---
name: youtube-transcript-extractor
description: Extract transcripts from YouTube videos using intelligent fallback methods (API → HTML → yt-dlp). Supports multiple languages and formats.
---

# YouTube Transcript Extractor

Extract clean, timestamped transcripts from any YouTube video. Uses intelligent fallback methods to ensure maximum reliability even when official captions aren't available.

## Features

- **Smart Extraction**: Tries multiple methods (API → HTML → yt-dlp)
- **Multi-Language**: Extract transcripts in any available language
- **Timestamped Output**: Includes timestamps for each caption segment
- **Reliable**: Fallback system ensures high success rate
- **Fast**: Optimized for speed with minimal dependencies

## Usage

### Basic Extraction

```bash
spacely run youtube-transcript-extractor --url "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
```

### Save to File

```bash
spacely run youtube-transcript-extractor --url "https://youtu.be/VIDEO_ID" --output transcript.md
```

### Extract Specific Language

```bash
spacely run youtube-transcript-extractor --url "https://youtube.com/watch?v=..." --lang es
```

## Input Parameters

**Required:**
- `url`: YouTube video URL (any format: youtube.com/watch?v=ID or youtu.be/ID)

**Optional:**
- `output`: Path to save transcript (defaults to stdout)
- `lang`: Language code (e.g., 'en', 'es', 'fr', 'de'). Uses video's primary language if not specified.

## Output Format

Transcripts include:
- Video title and metadata
- Timestamped caption segments
- Clean, readable text formatting
- Language information

## Common Use Cases

- Content summarization and analysis
- Creating show notes for podcasts/videos
- Accessibility (written version of video content)
- Research and data extraction
- Translation preparation
- SEO optimization

## How It Works

1. **API Method**: Attempts official YouTube transcript API (fastest)
2. **HTML Parsing**: Falls back to parsing caption data from page HTML
3. **yt-dlp**: Final fallback using yt-dlp subtitle extraction

This multi-tier approach ensures transcripts are extracted even from videos with non-standard caption configurations.

## Runtime

Node.js with minimal dependencies for fast startup and execution.
