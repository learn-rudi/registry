// YouTube Transcript Extractor using yt-dlp
// More reliable than JavaScript libraries

import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Check if yt-dlp is installed
 */
async function checkYtdlp() {
    try {
        const { stdout } = await execAsync('yt-dlp --version');
        console.log(`yt-dlp version: ${stdout.trim()}`);
        return true;
    } catch (error) {
        console.error('yt-dlp not found. Please install it:');
        console.error('  macOS: brew install yt-dlp');
        console.error('  npm: npm install -g yt-dlp-exec');
        console.error('  Direct: https://github.com/yt-dlp/yt-dlp#installation');
        return false;
    }
}

/**
 * Extract video ID from URL
 */
function extractVideoId(url) {
    const patterns = [
        /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/)([a-zA-Z0-9_-]{11})/,
        /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/
    ];
    
    for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match) return match[1];
    }
    
    if (/^[a-zA-Z0-9_-]{11}$/.test(url)) {
        return url;
    }
    
    throw new Error('Invalid YouTube URL or video ID');
}

/**
 * Parse SRT file to plain text
 */
async function parseSRT(srtPath) {
    const content = await fs.readFile(srtPath, 'utf8');
    
    // SRT format:
    // 1
    // 00:00:00,000 --> 00:00:02,000
    // Text line
    // 
    // 2
    // 00:00:02,000 --> 00:00:04,000
    // Next text line
    
    const lines = content.split(/\r?\n/);
    const textLines = [];
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        
        // Skip empty lines
        if (!line) continue;
        
        // Skip subtitle numbers (digits only)
        if (/^\d+$/.test(line)) continue;
        
        // Skip timestamp lines
        if (line.includes('-->')) continue;
        
        // This is a text line
        textLines.push(line);
    }
    
    // Join and clean up
    return textLines.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * Parse VTT file to plain text (keeping for backwards compatibility)
 */
async function parseVTT(vttPath) {
    const content = await fs.readFile(vttPath, 'utf8');
    
    // Remove WEBVTT header and timestamps
    const lines = content
        .split(/\r?\n/)
        .filter(line => 
            line && 
            line !== 'WEBVTT' && 
            line !== 'Kind: captions' &&
            !line.includes('Language:') &&
            !line.includes('-->') &&
            !line.match(/^\d{2}:\d{2}/)
        )
        .map(line => line.trim())
        .filter(line => line.length > 0);
    
    // Remove duplicate lines (common in auto-generated captions)
    const uniqueLines = [...new Set(lines)];
    
    return uniqueLines.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * Get YouTube video info and transcript
 */
export async function getYouTubeTranscript(url) {
    // Check if yt-dlp is available
    const hasYtdlp = await checkYtdlp();
    if (!hasYtdlp) {
        throw new Error('yt-dlp is required but not installed');
    }
    
    const videoId = extractVideoId(url);
    const outputDir = path.join(__dirname, 'temp');
    
    try {
        // Create temp directory
        await fs.mkdir(outputDir, { recursive: true });
        
        console.log(`Fetching info for video: ${videoId}`);
        
        // Get video info first
        const { stdout: infoJson } = await execAsync(
            `yt-dlp --dump-json --no-warnings "${url}"`,
            { maxBuffer: 10 * 1024 * 1024 }
        );
        
        const videoInfo = JSON.parse(infoJson);
        
        // Try to get subtitles
        console.log('Downloading subtitles...');
        
        // First try manual subtitles, then auto-generated
        const subtitleFile = path.join(outputDir, `${videoId}.en.vtt`);
        
        try {
            // Try to download subtitles with updated flags
            await execAsync(
                `yt-dlp --write-auto-sub --sub-lang en --convert-subs srt --skip-download ` +
                `--paths "${outputDir}" --output "${videoId}" "${url}"`,
                { maxBuffer: 10 * 1024 * 1024 }
            );
            
            // Check which subtitle file exists (now looking for SRT)
            let subtitlePath = null;
            const possibleFiles = [
                `${videoId}.en.srt`,
                `${videoId}.en-US.srt`,
                `${videoId}.en-GB.srt`,
                `${videoId}.srt`
            ];
            
            for (const file of possibleFiles) {
                const fullPath = path.join(outputDir, file);
                try {
                    await fs.access(fullPath);
                    subtitlePath = fullPath;
                    break;
                } catch {
                    // File doesn't exist, try next
                }
            }
            
            if (!subtitlePath) {
                // List available files to debug
                const files = await fs.readdir(outputDir);
                console.log('Available subtitle files:', files);
                
                // Try to find any .srt file
                const srtFile = files.find(f => f.endsWith('.srt'));
                if (srtFile) {
                    subtitlePath = path.join(outputDir, srtFile);
                }
            }
            
            if (subtitlePath) {
                const transcript = await parseSRT(subtitlePath);
                
                return {
                    success: true,
                    videoId,
                    url: videoInfo.webpage_url || url,
                    title: videoInfo.title,
                    author: videoInfo.uploader,
                    duration: videoInfo.duration,
                    description: videoInfo.description,
                    hasTranscript: true,
                    transcript,
                    metadata: {
                        viewCount: videoInfo.view_count,
                        likeCount: videoInfo.like_count,
                        uploadDate: videoInfo.upload_date,
                        thumbnail: videoInfo.thumbnail
                    }
                };
            } else {
                // No subtitles found
                return {
                    success: true,
                    videoId,
                    url: videoInfo.webpage_url || url,
                    title: videoInfo.title,
                    author: videoInfo.uploader,
                    duration: videoInfo.duration,
                    description: videoInfo.description,
                    hasTranscript: false,
                    transcript: '',
                    error: 'No subtitles available for this video'
                };
            }
            
        } catch (subError) {
            console.error('Subtitle download error:', subError.message);
            
            // Return video info without transcript
            return {
                success: true,
                videoId,
                url: videoInfo.webpage_url || url,
                title: videoInfo.title,
                author: videoInfo.uploader,
                duration: videoInfo.duration,
                description: videoInfo.description,
                hasTranscript: false,
                transcript: '',
                error: 'Could not download subtitles'
            };
        }
        
    } catch (error) {
        console.error('Error:', error);
        throw error;
    } finally {
        // Cleanup temp files
        try {
            const files = await fs.readdir(outputDir);
            for (const file of files) {
                await fs.unlink(path.join(outputDir, file));
            }
            await fs.rmdir(outputDir);
        } catch {
            // Ignore cleanup errors
        }
    }
}

/**
 * Format for Content Stack
 */
export async function extractYouTubeForContentStack(url) {
    try {
        const result = await getYouTubeTranscript(url);

        const duration = result.duration ?
            `${Math.floor(result.duration / 60)} minutes ${result.duration % 60} seconds` :
            'Unknown';

        // Format upload date if available
        const uploadDate = result.metadata?.uploadDate ?
            result.metadata.uploadDate.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3') :
            'Unknown';

        if (!result.hasTranscript) {
            const content = `# YouTube: ${result.title}

**Channel:** ${result.author}
**Duration:** ${duration}
**Views:** ${result.metadata?.viewCount?.toLocaleString() || 'N/A'}
**Published:** ${uploadDate}
**URL:** ${result.url}

## Description

${result.description || 'No description available'}

---

**Note:** ${result.error || 'No transcript available for this video'}`;

            return {
                platform: 'youtube',
                title: result.title || 'YouTube Video',
                author: result.author,
                url: result.url,
                content: content,
                metadata: result.metadata,
                success: true
            };
        }

        // Calculate word count
        const wordCount = result.transcript.split(/\s+/).filter(w => w.length > 0).length;

        const content = `# YouTube: ${result.title}

**Channel:** ${result.author}
**Duration:** ${duration}
**Views:** ${result.metadata?.viewCount?.toLocaleString() || 'N/A'}
**Published:** ${uploadDate}
**URL:** ${result.url}

## Description

${result.description || 'No description available'}

---

## Transcript

**Word Count:** ${wordCount.toLocaleString()}

${result.transcript}`;

        return {
            platform: 'youtube',
            title: result.title,
            author: result.author,
            url: result.url,
            content: content,
            metadata: {
                ...result.metadata,
                transcriptWordCount: wordCount
            },
            hasTranscript: true,
            success: true
        };

    } catch (error) {
        return {
            platform: 'youtube',
            title: 'YouTube Video',
            url: url,
            content: `# YouTube Video

**Error:** Failed to extract content

${error.message}

**URL:** ${url}`,
            error: error.message,
            success: false
        };
    }
}

// CLI usage
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
    const url = process.argv[2];
    const outputFile = process.argv[3] || 'youtube-transcript.txt';
    
    if (!url) {
        console.log(`
Usage: node youtube-ytdlp.js <youtube-url> [output-file]

Examples:
  node youtube-ytdlp.js https://www.youtube.com/watch?v=VIDEO_ID
  node youtube-ytdlp.js https://youtu.be/VIDEO_ID
  node youtube-ytdlp.js VIDEO_ID output.txt

Requirements:
  - yt-dlp must be installed (brew install yt-dlp)
`);
        process.exit(0);
    }
    
    console.log(`\nExtracting from: ${url}\n`);
    
    getYouTubeTranscript(url)
        .then(async result => {
            const content = await extractYouTubeForContentStack(url);
            await fs.writeFile(outputFile, content.content, 'utf8');
            
            console.log(`\n✅ Saved to: ${outputFile}`);
            console.log(`   Title: ${result.title}`);
            console.log(`   Author: ${result.author}`);
            console.log(`   Has transcript: ${result.hasTranscript}`);
            
            if (!result.hasTranscript) {
                console.log(`   Note: ${result.error}`);
            }
        })
        .catch(error => {
            console.error('\n❌ Error:', error.message);
            process.exit(1);
        });
}