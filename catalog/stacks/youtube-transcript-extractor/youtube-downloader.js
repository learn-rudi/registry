// YouTube Video Downloader using yt-dlp
// Extends the existing transcript extractor with video download capabilities

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
 * Get available video formats
 */
export async function getAvailableFormats(url) {
    const hasYtdlp = await checkYtdlp();
    if (!hasYtdlp) {
        throw new Error('yt-dlp is required but not installed');
    }

    try {
        console.log('Fetching available formats...');
        const { stdout } = await execAsync(
            `yt-dlp -F --no-warnings "${url}"`,
            { maxBuffer: 10 * 1024 * 1024 }
        );
        
        return stdout;
    } catch (error) {
        throw new Error(`Failed to get formats: ${error.message}`);
    }
}

/**
 * Download YouTube video
 */
export async function downloadYouTubeVideo(url, options = {}) {
    const hasYtdlp = await checkYtdlp();
    if (!hasYtdlp) {
        throw new Error('yt-dlp is required but not installed');
    }

    const {
        outputDir = '/Users/hoff/Downloads',
        quality = 'best[height<=1080]',
        format = 'mp4',
        audioOnly = false,
        audioFormat = 'mp3',
        filename = '%(title)s.%(ext)s'
    } = options;

    try {
        // Ensure output directory exists
        await fs.mkdir(outputDir, { recursive: true });

        console.log(`Downloading from: ${url}`);
        console.log(`Output directory: ${outputDir}`);

        let command;
        if (audioOnly) {
            // Audio-only download
            command = `yt-dlp -x --audio-format ${audioFormat} -o "${path.join(outputDir, filename)}" "${url}"`;
        } else {
            // Video download
            command = `yt-dlp -f "${quality}" --merge-output-format ${format} -o "${path.join(outputDir, filename)}" "${url}"`;
        }

        console.log(`Running: ${command}`);
        
        const { stdout, stderr } = await execAsync(command, { 
            maxBuffer: 50 * 1024 * 1024 // 50MB buffer for large downloads
        });

        // Parse the output to find the downloaded file
        const lines = stdout.split('\n');
        let downloadedFile = null;
        
        for (const line of lines) {
            if (line.includes('Destination:') || line.includes('[download]') && line.includes('%')) {
                const match = line.match(/(?:Destination:\s*|100%\s+of\s+[\d.]+\w+\s+in\s+[\d:]+\s+)(.+?)(?:\s+|$)/);
                if (match) {
                    downloadedFile = match[1].trim();
                    break;
                }
            }
        }

        return {
            success: true,
            downloadedFile,
            outputDir,
            stdout,
            message: 'Download completed successfully!'
        };

    } catch (error) {
        return {
            success: false,
            error: error.message,
            message: `Download failed: ${error.message}`
        };
    }
}

/**
 * Download with preset configurations
 */
export const downloadPresets = {
    // High quality video (1080p max)
    highQuality: (url, outputDir) => downloadYouTubeVideo(url, {
        outputDir,
        quality: 'best[height<=1080]',
        format: 'mp4'
    }),

    // Medium quality video (720p max)
    mediumQuality: (url, outputDir) => downloadYouTubeVideo(url, {
        outputDir,
        quality: 'best[height<=720]',
        format: 'mp4'
    }),

    // Low quality video (480p max)
    lowQuality: (url, outputDir) => downloadYouTubeVideo(url, {
        outputDir,
        quality: 'best[height<=480]',
        format: 'mp4'
    }),

    // Audio only (MP3)
    audioMp3: (url, outputDir) => downloadYouTubeVideo(url, {
        outputDir,
        audioOnly: true,
        audioFormat: 'mp3'
    }),

    // Audio only (M4A)
    audioM4a: (url, outputDir) => downloadYouTubeVideo(url, {
        outputDir,
        audioOnly: true,
        audioFormat: 'm4a'
    })
};

// CLI usage
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
    const command = process.argv[2];
    const url = process.argv[3];
    const outputDir = process.argv[4] || '/Users/hoff/Downloads';

    if (!command || !url) {
        console.log(`
YouTube Video Downloader

Usage:
  node youtube-downloader.js <command> <youtube-url> [output-directory]

Commands:
  download       - Download best quality video (1080p max)
  high           - Download high quality video (1080p max)
  medium         - Download medium quality video (720p max)  
  low            - Download low quality video (480p max)
  audio          - Download audio only (MP3)
  audio-m4a      - Download audio only (M4A)
  formats        - Show available formats

Examples:
  node youtube-downloader.js download https://www.youtube.com/watch?v=VIDEO_ID
  node youtube-downloader.js audio https://youtu.be/VIDEO_ID /Users/hoff/Music
  node youtube-downloader.js formats https://www.youtube.com/watch?v=VIDEO_ID
  node youtube-downloader.js high https://www.youtube.com/watch?v=VIDEO_ID /Users/hoff/Videos

Output directory defaults to: /Users/hoff/Downloads
`);
        process.exit(0);
    }

    console.log(`\n🚀 YouTube Downloader\n`);

    async function runCommand() {
        try {
            switch (command) {
                case 'download':
                case 'high':
                    const highResult = await downloadPresets.highQuality(url, outputDir);
                    console.log(highResult.success ? `✅ ${highResult.message}` : `❌ ${highResult.message}`);
                    if (highResult.downloadedFile) {
                        console.log(`📁 File: ${highResult.downloadedFile}`);
                    }
                    break;

                case 'medium':
                    const medResult = await downloadPresets.mediumQuality(url, outputDir);
                    console.log(medResult.success ? `✅ ${medResult.message}` : `❌ ${medResult.message}`);
                    if (medResult.downloadedFile) {
                        console.log(`📁 File: ${medResult.downloadedFile}`);
                    }
                    break;

                case 'low':
                    const lowResult = await downloadPresets.lowQuality(url, outputDir);
                    console.log(lowResult.success ? `✅ ${lowResult.message}` : `❌ ${lowResult.message}`);
                    if (lowResult.downloadedFile) {
                        console.log(`📁 File: ${lowResult.downloadedFile}`);
                    }
                    break;

                case 'audio':
                    const audioResult = await downloadPresets.audioMp3(url, outputDir);
                    console.log(audioResult.success ? `✅ ${audioResult.message}` : `❌ ${audioResult.message}`);
                    if (audioResult.downloadedFile) {
                        console.log(`📁 File: ${audioResult.downloadedFile}`);
                    }
                    break;

                case 'audio-m4a':
                    const m4aResult = await downloadPresets.audioM4a(url, outputDir);
                    console.log(m4aResult.success ? `✅ ${m4aResult.message}` : `❌ ${m4aResult.message}`);
                    if (m4aResult.downloadedFile) {
                        console.log(`📁 File: ${m4aResult.downloadedFile}`);
                    }
                    break;

                case 'formats':
                    const formats = await getAvailableFormats(url);
                    console.log('Available formats:\n');
                    console.log(formats);
                    break;

                default:
                    console.error(`❌ Unknown command: ${command}`);
                    process.exit(1);
            }
        } catch (error) {
            console.error(`❌ Error: ${error.message}`);
            process.exit(1);
        }
    }

    runCommand();
}