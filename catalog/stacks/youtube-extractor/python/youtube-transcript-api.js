#!/usr/bin/env node

/**
 * YouTube Transcript Extractor - Supadata Edition
 *
 * Priority hierarchy for transcript extraction:
 * 0. Supadata API - Professional service (FASTEST, MOST RELIABLE)
 * 1. youtube-transcript (npm) - Lightweight, direct API access
 * 2. Direct YouTube API scraping - Parse from page HTML
 * 3. yt-dlp - Heavy fallback when APIs fail
 *
 * This approach prioritizes:
 * - Speed (no video download)
 * - Reliability (multiple fallback methods)
 * - Professional API service first, then local methods
 * - No system dependencies (pure Node.js first)
 */

import { YoutubeTranscript } from 'youtube-transcript';
import fetch from 'node-fetch';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Extract video ID from any YouTube URL format
 */
function extractVideoId(url) {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/)([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/live\/([a-zA-Z0-9_-]{11})/
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }

  // Check if it's already just a video ID
  if (/^[a-zA-Z0-9_-]{11}$/.test(url)) {
    return url;
  }

  throw new Error('Invalid YouTube URL or video ID');
}

/**
 * METHOD 0: Use SupaData API (PROFESSIONAL SERVICE - FASTEST & MOST RELIABLE)
 * Cloud-optimized service specifically designed for YouTube transcripts
 * Requires SUPA_DATA_API environment variable
 */
async function getTranscriptViaSupaData(videoId, url) {
  const apiKey = process.env.SUPA_DATA_API;

  if (!apiKey) {
    console.log('  ℹ️  SupaData API key not configured (set SUPA_DATA_API env var)');
    return { success: false, error: 'SupaData API key not configured' };
  }

  try {
    console.log('  → Trying Method 0: SupaData API...');

    const apiUrl = new URL('https://api.supadata.ai/v1/youtube/transcript');
    apiUrl.searchParams.append('url', url);
    apiUrl.searchParams.append('text', 'true');

    const response = await fetch(apiUrl.toString(), {
      method: 'GET',
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`SupaData API returned ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    const transcript = data.content || '';

    if (!transcript) {
      throw new Error('SupaData returned empty transcript');
    }

    return {
      success: true,
      method: 'supadata-api',
      transcript: transcript.trim(),
      lang: data.lang || 'en'
    };
  } catch (error) {
    console.log(`  ✗ Method 0 failed: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * METHOD 1: Use youtube-transcript npm package (FAST)
 * Direct API access, no video download required
 */
async function getTranscriptViaAPI(videoId) {
  try {
    console.log('  → Trying Method 1: youtube-transcript API...');

    const transcript = await YoutubeTranscript.fetchTranscript(videoId);

    // Check if transcript is empty
    if (!transcript || transcript.length === 0) {
      throw new Error('Transcript returned empty array - no captions available');
    }

    // Combine all text segments
    const fullText = transcript
      .map(segment => segment.text)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    // Double-check we actually got text
    if (!fullText || fullText.length === 0) {
      throw new Error('Transcript segments contained no text');
    }

    return {
      success: true,
      method: 'youtube-transcript-api',
      transcript: fullText,
      segments: transcript.length
    };
  } catch (error) {
    console.log(`  ✗ Method 1 failed: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * METHOD 2: Scrape transcript directly from YouTube page HTML
 * More reliable when API rate limits hit
 */
async function getTranscriptViaHTML(videoId) {
  try {
    console.log('  → Trying Method 2: HTML scraping...');

    const url = `https://www.youtube.com/watch?v=${videoId}`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      }
    });

    const html = await response.text();

    // Look for captions data in the page
    // YouTube embeds caption tracks in JSON within the HTML
    const captionsRegex = /"captions":\{"playerCaptionsTracklistRenderer":\{"captionTracks":\[(.*?)\]/;
    const match = html.match(captionsRegex);

    if (!match) {
      throw new Error('No captions found in page HTML');
    }

    // Parse caption tracks
    const captionTracks = JSON.parse(`[${match[1]}]`);

    // Find English captions
    const englishTrack = captionTracks.find(track =>
      track.languageCode === 'en' || track.languageCode.startsWith('en-')
    );

    if (!englishTrack) {
      throw new Error('No English captions available');
    }

    // Fetch the caption XML
    const captionResponse = await fetch(englishTrack.baseUrl);
    const captionXML = await captionResponse.text();

    // Parse XML to extract text
    const textRegex = /<text[^>]*>(.*?)<\/text>/g;
    const texts = [];
    let textMatch;

    while ((textMatch = textRegex.exec(captionXML)) !== null) {
      // Decode HTML entities
      const decodedText = textMatch[1]
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/<[^>]+>/g, ''); // Remove any remaining tags

      texts.push(decodedText);
    }

    const fullText = texts.join(' ').replace(/\s+/g, ' ').trim();

    return {
      success: true,
      method: 'html-scraping',
      transcript: fullText,
      segments: texts.length
    };
  } catch (error) {
    console.log(`  ✗ Method 2 failed: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * METHOD 3: Use yt-dlp as fallback (SLOWEST but most reliable)
 * Requires yt-dlp to be installed
 */
async function getTranscriptViaYtdlp(videoId) {
  try {
    console.log('  → Trying Method 3: yt-dlp fallback...');

    // Check if yt-dlp is installed
    try {
      await execAsync('yt-dlp --version');
    } catch {
      throw new Error('yt-dlp not installed (brew install yt-dlp)');
    }

    const url = `https://www.youtube.com/watch?v=${videoId}`;

    // Get subtitles only (no video download)
    const { stdout } = await execAsync(
      `yt-dlp --write-auto-sub --sub-lang en --skip-download --print "%(subtitles)s" "${url}"`,
      { maxBuffer: 10 * 1024 * 1024 }
    );

    if (!stdout || stdout.trim() === '{}') {
      throw new Error('No subtitles available via yt-dlp');
    }

    // Download the subtitle file
    const { stdout: subtitleContent } = await execAsync(
      `yt-dlp --write-auto-sub --sub-lang en --skip-download --get-filename -o "%(id)s.%(ext)s" --print after_move:filepath "${url}"`,
      { maxBuffer: 10 * 1024 * 1024 }
    );

    return {
      success: true,
      method: 'yt-dlp',
      transcript: subtitleContent.trim()
    };
  } catch (error) {
    console.log(`  ✗ Method 3 failed: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * Get video metadata from YouTube
 */
async function getVideoMetadata(videoId) {
  try {
    const url = `https://www.youtube.com/watch?v=${videoId}`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      }
    });

    const html = await response.text();

    // Extract metadata from page
    const titleMatch = html.match(/<meta name="title" content="([^"]+)">/);
    const descMatch = html.match(/<meta name="description" content="([^"]+)">/);
    const authorMatch = html.match(/"author":"([^"]+)"/);
    const viewsMatch = html.match(/"viewCount":"(\d+)"/);
    const lengthMatch = html.match(/"lengthSeconds":"(\d+)"/);

    return {
      title: titleMatch ? titleMatch[1] : 'Unknown Title',
      description: descMatch ? descMatch[1] : '',
      author: authorMatch ? authorMatch[1] : 'Unknown Channel',
      viewCount: viewsMatch ? parseInt(viewsMatch[1]) : 0,
      duration: lengthMatch ? parseInt(lengthMatch[1]) : 0,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      videoId
    };
  } catch (error) {
    return {
      title: 'Unknown Title',
      description: '',
      author: 'Unknown Channel',
      viewCount: 0,
      duration: 0,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      videoId
    };
  }
}

/**
 * Main extraction function with fallback hierarchy
 */
export async function extractYouTubeTranscript(url) {
  console.log(`\n🎥 Extracting YouTube transcript...`);

  const videoId = extractVideoId(url);
  console.log(`   Video ID: ${videoId}`);

  // Get metadata first
  console.log(`   Fetching metadata...`);
  const metadata = await getVideoMetadata(videoId);
  console.log(`   ✓ Title: ${metadata.title}`);
  console.log(`   ✓ Channel: ${metadata.author}`);

  // Try methods in order of preference
  // Method 0 (SupaData) needs both videoId and url
  const methods = [
    { fn: getTranscriptViaSupaData, needsUrl: true },
    { fn: getTranscriptViaAPI, needsUrl: false },
    { fn: getTranscriptViaHTML, needsUrl: false },
    { fn: getTranscriptViaYtdlp, needsUrl: false }
  ];

  for (const { fn: method, needsUrl } of methods) {
    const result = needsUrl ? await method(videoId, url) : await method(videoId);

    if (result.success) {
      console.log(`   ✅ Success via ${result.method}!`);
      console.log(`   📝 Transcript: ${result.transcript.length.toLocaleString()} characters`);

      const wordCount = result.transcript.split(/\s+/).filter(w => w.length > 0).length;

      return {
        success: true,
        videoId,
        ...metadata,
        hasTranscript: true,
        transcript: result.transcript,
        wordCount,
        extractionMethod: result.method,
        segments: result.segments || 0
      };
    }
  }

  // All methods failed
  console.log(`   ❌ All extraction methods failed`);

  return {
    success: true, // Still return metadata even without transcript
    videoId,
    ...metadata,
    hasTranscript: false,
    transcript: '',
    error: 'No transcript available - all extraction methods failed'
  };
}

/**
 * Format for Content Stack
 */
export async function extractYouTubeForContentStack(url) {
  try {
    const result = await extractYouTubeTranscript(url);

    const duration = result.duration ?
      `${Math.floor(result.duration / 60)}:${String(result.duration % 60).padStart(2, '0')}` :
      'Unknown';

    const content = result.hasTranscript ?
      `# ${result.title}

**Channel:** ${result.author}
**Duration:** ${duration}
**Views:** ${result.viewCount?.toLocaleString() || 'N/A'}
**URL:** ${result.url}
**Extraction Method:** ${result.extractionMethod}

## Description

${result.description || 'No description available'}

---

## Transcript

**Word Count:** ${result.wordCount?.toLocaleString()} words
**Segments:** ${result.segments || 'N/A'}

${result.transcript}` :
      `# ${result.title}

**Channel:** ${result.author}
**Duration:** ${duration}
**Views:** ${result.viewCount?.toLocaleString() || 'N/A'}
**URL:** ${result.url}

## Description

${result.description || 'No description available'}

---

**Note:** ${result.error || 'No transcript available for this video'}`;

    return {
      platform: 'youtube',
      title: result.title,
      author: result.author,
      url: result.url,
      content,
      metadata: {
        videoId: result.videoId,
        duration: result.duration,
        viewCount: result.viewCount,
        wordCount: result.wordCount,
        extractionMethod: result.extractionMethod,
        hasTranscript: result.hasTranscript
      },
      hasTranscript: result.hasTranscript,
      success: true
    };
  } catch (error) {
    console.error('❌ Extraction failed:', error);

    return {
      platform: 'youtube',
      title: 'YouTube Video',
      url,
      content: `# YouTube Video\n\n**Error:** ${error.message}\n\n**URL:** ${url}`,
      error: error.message,
      success: false
    };
  }
}

// CLI usage
if (import.meta.url.endsWith(process.argv[1]?.split('/').pop() || '')) {
  const url = process.argv[2];
  const outputFile = process.argv[3];

  if (!url) {
    console.log(`
Usage: node youtube-transcript-api.js <youtube-url> [output.md]

Examples:
  node youtube-transcript-api.js https://www.youtube.com/watch?v=dQw4w9WgXcQ
  node youtube-transcript-api.js https://youtu.be/dQw4w9WgXcQ output.md
  node youtube-transcript-api.js dQw4w9WgXcQ

Methods (tried in order):
  0. SupaData API (professional service, fastest, most reliable)
     - Requires SUPA_DATA_API environment variable
     - Sign up at: https://supadata.ai
  1. youtube-transcript API (fast, no dependencies)
  2. HTML scraping (reliable, no dependencies)
  3. yt-dlp fallback (slowest, requires installation)

Installation:
  npm install youtube-transcript node-fetch

Setup SupaData (optional, recommended):
  export SUPA_DATA_API="your-api-key-here"
  # Or add to .env file
`);
    process.exit(0);
  }

  extractYouTubeForContentStack(url)
    .then(async result => {
      if (outputFile) {
        const fs = await import('fs/promises');
        await fs.writeFile(outputFile, result.content, 'utf8');
        console.log(`\n✅ Saved to: ${outputFile}`);
      } else {
        console.log('\n' + result.content);
      }
    })
    .catch(error => {
      console.error('\n❌ Error:', error.message);
      process.exit(1);
    });
}
