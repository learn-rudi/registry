#!/usr/bin/env node
/**
 * Video Editor MCP
 * Edit videos with ffmpeg - trim, speed up, extract clips, remove silence, and more
 *
 * Usage:
 *   - As MCP: Run without args, speaks JSON-RPC
 *   - As API: import { videoTrim, videoSpeed, ... } from './index'
 *   - As CLI: node index.ts <command> <input> [options]
 *
 * CLI Examples:
 *   node index.ts info video.mov
 *   node index.ts trim video.mov --last 120
 *   node index.ts speed video.mov --target 120
 *   node index.ts compress video.mov --crf 23
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { exec } from "child_process";
import { promisify } from "util";
import { existsSync, statSync, readdirSync } from "fs";
import { basename, dirname, join, extname } from "path";
import { homedir } from "os";

const execAsync = promisify(exec);
const DEFAULT_OUTPUT_DIR = join(homedir(), ".prompt-stack", "output");

// Use homebrew ffmpeg/ffprobe if available, otherwise fall back to PATH
const FFMPEG = existsSync("/opt/homebrew/bin/ffmpeg") ? "/opt/homebrew/bin/ffmpeg" : "ffmpeg";
const FFPROBE = existsSync("/opt/homebrew/bin/ffprobe") ? "/opt/homebrew/bin/ffprobe" : "ffprobe";

// =============================================================================
// UTILITIES
// =============================================================================

function sanitizePath(inputPath: string): string {
  // Handle paths with unicode characters (like macOS narrow no-break space)
  return inputPath.trim();
}

async function findFile(pattern: string, dir: string): Promise<string | null> {
  // Handle files with special unicode characters in names
  try {
    const files = readdirSync(dir);
    const match = files.find(f => f.includes(pattern));
    if (match) return join(dir, match);
  } catch {}
  return null;
}

async function resolveInputPath(input: string): Promise<string> {
  const sanitized = sanitizePath(input);
  if (existsSync(sanitized)) return sanitized;

  // Try to find file by pattern if direct path fails (unicode issues)
  const dir = dirname(sanitized);
  const name = basename(sanitized);
  const found = await findFile(name.slice(0, 20), dir);
  if (found) return found;

  throw new Error(`File not found: ${input}`);
}

function getOutputPath(input: string, suffix: string, outputDir?: string): string {
  const dir = outputDir || dirname(input);
  const ext = extname(input);
  const name = basename(input, ext);
  return join(dir, `${name}${suffix}${ext}`);
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(1)} KB`;
  return `${bytes} bytes`;
}

async function getVideoInfo(inputPath: string): Promise<{
  duration: number;
  width: number;
  height: number;
  fps: number;
  bitrate: number;
  codec: string;
  audioCodec: string;
  size: number;
}> {
  const { stdout } = await execAsync(
    `${FFPROBE} -v quiet -print_format json -show_format -show_streams "${inputPath}"`
  );
  const data = JSON.parse(stdout);
  const videoStream = data.streams?.find((s: any) => s.codec_type === "video") || {};
  const audioStream = data.streams?.find((s: any) => s.codec_type === "audio") || {};

  return {
    duration: parseFloat(data.format?.duration || "0"),
    width: videoStream.width || 0,
    height: videoStream.height || 0,
    fps: eval(videoStream.r_frame_rate || "0") || 0,
    bitrate: parseInt(data.format?.bit_rate || "0"),
    codec: videoStream.codec_name || "unknown",
    audioCodec: audioStream.codec_name || "none",
    size: parseInt(data.format?.size || "0"),
  };
}

// =============================================================================
// VIDEO OPERATIONS
// =============================================================================

async function videoInfo(input: string): Promise<string> {
  const inputPath = await resolveInputPath(input);
  const info = await getVideoInfo(inputPath);

  return `**Video Info**

**File:** ${basename(inputPath)}
**Duration:** ${formatDuration(info.duration)}
**Resolution:** ${info.width}x${info.height}
**FPS:** ${info.fps.toFixed(2)}
**Video Codec:** ${info.codec}
**Audio Codec:** ${info.audioCodec}
**Bitrate:** ${(info.bitrate / 1e6).toFixed(1)} Mbps
**Size:** ${formatBytes(info.size)}`;
}

async function videoTrim(
  input: string,
  options: { start?: string; end?: string; duration?: string; last?: number; output?: string }
): Promise<string> {
  const inputPath = await resolveInputPath(input);
  const info = await getVideoInfo(inputPath);

  let ffmpegArgs: string[] = [];
  let suffix = "-trimmed";

  if (options.last) {
    // Extract last N seconds
    ffmpegArgs = ["-sseof", `-${options.last}`];
    suffix = `-last${options.last}s`;
  } else if (options.start && options.end) {
    ffmpegArgs = ["-ss", options.start, "-to", options.end];
    suffix = `-${options.start.replace(/:/g, "")}-${options.end.replace(/:/g, "")}`;
  } else if (options.start && options.duration) {
    ffmpegArgs = ["-ss", options.start, "-t", options.duration];
    suffix = `-from${options.start.replace(/:/g, "")}`;
  } else if (options.start) {
    ffmpegArgs = ["-ss", options.start];
    suffix = `-from${options.start.replace(/:/g, "")}`;
  } else if (options.duration) {
    ffmpegArgs = ["-t", options.duration];
    suffix = `-first${options.duration}`;
  }

  const outputPath = options.output || getOutputPath(inputPath, suffix);

  await execAsync(
    `${FFMPEG} -y ${ffmpegArgs.join(" ")} -i "${inputPath}" -c copy "${outputPath}"`
  );

  const outputInfo = await getVideoInfo(outputPath);

  return `**Trimmed Video**

**Input:** ${basename(inputPath)} (${formatDuration(info.duration)})
**Output:** ${outputPath}
**Duration:** ${formatDuration(outputInfo.duration)}
**Size:** ${formatBytes(outputInfo.size)}`;
}

async function videoSpeed(
  input: string,
  options: { speed?: number; targetDuration?: number; output?: string }
): Promise<string> {
  const inputPath = await resolveInputPath(input);
  const info = await getVideoInfo(inputPath);

  let speed = options.speed || 1;

  if (options.targetDuration) {
    speed = info.duration / options.targetDuration;
  }

  const outputPath = options.output || getOutputPath(inputPath, `-${speed}x`, dirname(inputPath));
  const ext = extname(outputPath).toLowerCase();

  // For high speed factors, drop audio (can't speed up audio >4x reasonably)
  const dropAudio = speed > 4;

  const videoFilter = `setpts=PTS/${speed}`;
  const audioFilter = dropAudio ? "" : `-filter:a "atempo=${Math.min(speed, 2)}"`;

  // Use mp4 for better compatibility with speed changes
  const outputExt = ext === ".mov" ? ".mp4" : ext;
  const finalOutput = outputPath.replace(ext, outputExt);

  const cmd = dropAudio
    ? `${FFMPEG} -y -i "${inputPath}" -filter:v "${videoFilter}" -an -c:v libx264 -preset fast -crf 23 "${finalOutput}"`
    : `${FFMPEG} -y -i "${inputPath}" -filter:v "${videoFilter}" ${audioFilter} -c:v libx264 -preset fast -crf 23 "${finalOutput}"`;

  await execAsync(cmd, { maxBuffer: 50 * 1024 * 1024 });

  const outputInfo = await getVideoInfo(finalOutput);

  return `**Speed Changed Video**

**Input:** ${basename(inputPath)} (${formatDuration(info.duration)})
**Speed:** ${speed.toFixed(1)}x${dropAudio ? " (audio removed)" : ""}
**Output:** ${finalOutput}
**Duration:** ${formatDuration(outputInfo.duration)}
**Size:** ${formatBytes(outputInfo.size)}`;
}

async function videoExtractAudio(
  input: string,
  options: { format?: string; output?: string }
): Promise<string> {
  const inputPath = await resolveInputPath(input);
  const format = options.format || "mp3";
  const ext = extname(inputPath);
  const outputPath = options.output || inputPath.replace(ext, `.${format}`);

  const codecMap: Record<string, string> = {
    mp3: "libmp3lame",
    aac: "aac",
    wav: "pcm_s16le",
    flac: "flac",
    ogg: "libvorbis",
  };

  const codec = codecMap[format] || "copy";

  await execAsync(`${FFMPEG} -y -i "${inputPath}" -vn -acodec ${codec} "${outputPath}"`);

  const stat = statSync(outputPath);

  return `**Audio Extracted**

**Input:** ${basename(inputPath)}
**Output:** ${outputPath}
**Format:** ${format.toUpperCase()}
**Size:** ${formatBytes(stat.size)}`;
}

async function videoRemoveSilence(
  input: string,
  options: { threshold?: string; minDuration?: number; padding?: number; output?: string }
): Promise<string> {
  const inputPath = await resolveInputPath(input);
  const info = await getVideoInfo(inputPath);

  const threshold = options.threshold || "-30dB";
  const minDuration = options.minDuration || 0.5;
  const padding = options.padding || 0.1;

  // Detect silence
  const { stderr } = await execAsync(
    `${FFMPEG} -i "${inputPath}" -af "silencedetect=noise=${threshold}:d=${minDuration}" -f null - 2>&1`
  );

  // Parse silence periods
  const silenceStarts: number[] = [];
  const silenceEnds: number[] = [];

  const startRegex = /silence_start: ([\d.]+)/g;
  const endRegex = /silence_end: ([\d.]+)/g;

  let match;
  while ((match = startRegex.exec(stderr)) !== null) {
    silenceStarts.push(parseFloat(match[1]));
  }
  while ((match = endRegex.exec(stderr)) !== null) {
    silenceEnds.push(parseFloat(match[1]));
  }

  if (silenceStarts.length === 0) {
    return `**No Silence Detected**

**Input:** ${basename(inputPath)}
**Threshold:** ${threshold}
**Min Duration:** ${minDuration}s

No silent segments found matching criteria.`;
  }

  // Calculate segments to keep
  const segments: { start: number; end: number }[] = [];
  let lastEnd = 0;

  for (let i = 0; i < silenceStarts.length; i++) {
    const silenceStart = silenceStarts[i];
    const silenceEnd = silenceEnds[i] || info.duration;

    if (silenceStart > lastEnd + padding) {
      segments.push({
        start: Math.max(0, lastEnd - padding),
        end: Math.min(info.duration, silenceStart + padding),
      });
    }
    lastEnd = silenceEnd;
  }

  // Add final segment
  if (lastEnd < info.duration - padding) {
    segments.push({
      start: Math.max(0, lastEnd - padding),
      end: info.duration,
    });
  }

  // Create temp directory and extract segments
  const tempDir = join(dirname(inputPath), ".silence-temp");
  await execAsync(`mkdir -p "${tempDir}"`);

  const concatFile = join(tempDir, "concat.txt");
  const segmentPaths: string[] = [];

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const segPath = join(tempDir, `seg${i.toString().padStart(3, "0")}.ts`);
    segmentPaths.push(segPath);

    await execAsync(
      `${FFMPEG} -y -ss ${seg.start} -t ${seg.end - seg.start} -i "${inputPath}" -c copy -bsf:v h264_mp4toannexb -f mpegts "${segPath}"`
    );
  }

  // Write concat file
  const concatContent = segmentPaths.map(p => `file '${p}'`).join("\n");
  await execAsync(`echo '${concatContent}' > "${concatFile}"`);

  // Concatenate
  const outputPath = options.output || getOutputPath(inputPath, "-nosilence");
  await execAsync(
    `${FFMPEG} -y -f concat -safe 0 -i "${concatFile}" -c copy "${outputPath}"`
  );

  // Cleanup
  await execAsync(`rm -rf "${tempDir}"`);

  const outputInfo = await getVideoInfo(outputPath);
  const removed = info.duration - outputInfo.duration;
  const percentRemoved = ((removed / info.duration) * 100).toFixed(1);

  return `**Silence Removed**

**Input:** ${basename(inputPath)} (${formatDuration(info.duration)})
**Output:** ${outputPath}
**Duration:** ${formatDuration(outputInfo.duration)}
**Removed:** ${formatDuration(removed)} (${percentRemoved}%)
**Silent Segments:** ${silenceStarts.length}
**Threshold:** ${threshold}`;
}

async function videoResize(
  input: string,
  options: { width?: number; height?: number; scale?: number; output?: string }
): Promise<string> {
  const inputPath = await resolveInputPath(input);
  const info = await getVideoInfo(inputPath);

  let filter: string;
  let suffix: string;

  if (options.scale) {
    const newWidth = Math.round(info.width * options.scale);
    const newHeight = Math.round(info.height * options.scale);
    filter = `scale=${newWidth}:${newHeight}`;
    suffix = `-${Math.round(options.scale * 100)}pct`;
  } else if (options.width && options.height) {
    filter = `scale=${options.width}:${options.height}`;
    suffix = `-${options.width}x${options.height}`;
  } else if (options.width) {
    filter = `scale=${options.width}:-2`;
    suffix = `-w${options.width}`;
  } else if (options.height) {
    filter = `scale=-2:${options.height}`;
    suffix = `-h${options.height}`;
  } else {
    throw new Error("Must specify width, height, or scale");
  }

  const outputPath = options.output || getOutputPath(inputPath, suffix);

  await execAsync(
    `${FFMPEG} -y -i "${inputPath}" -vf "${filter}" -c:a copy "${outputPath}"`
  );

  const outputInfo = await getVideoInfo(outputPath);

  return `**Resized Video**

**Input:** ${basename(inputPath)} (${info.width}x${info.height})
**Output:** ${outputPath}
**Resolution:** ${outputInfo.width}x${outputInfo.height}
**Size:** ${formatBytes(outputInfo.size)}`;
}

async function videoCompress(
  input: string,
  options: { crf?: number; preset?: string; maxBitrate?: string; output?: string }
): Promise<string> {
  const inputPath = await resolveInputPath(input);
  const info = await getVideoInfo(inputPath);

  const crf = options.crf || 28;
  const preset = options.preset || "medium";

  const outputPath = options.output || getOutputPath(inputPath, "-compressed", dirname(inputPath));

  let cmd = `${FFMPEG} -y -i "${inputPath}" -c:v libx264 -crf ${crf} -preset ${preset} -c:a aac -b:a 128k`;

  if (options.maxBitrate) {
    cmd += ` -maxrate ${options.maxBitrate} -bufsize ${options.maxBitrate}`;
  }

  cmd += ` "${outputPath}"`;

  await execAsync(cmd, { maxBuffer: 50 * 1024 * 1024 });

  const outputInfo = await getVideoInfo(outputPath);
  const reduction = ((1 - outputInfo.size / info.size) * 100).toFixed(1);

  return `**Compressed Video**

**Input:** ${basename(inputPath)} (${formatBytes(info.size)})
**Output:** ${outputPath}
**Size:** ${formatBytes(outputInfo.size)} (${reduction}% smaller)
**CRF:** ${crf}
**Preset:** ${preset}`;
}

async function videoFrames(
  input: string,
  options: { interval?: number; count?: number; timestamps?: string[]; format?: string; output?: string }
): Promise<string> {
  const inputPath = await resolveInputPath(input);
  const info = await getVideoInfo(inputPath);
  const format = options.format || "jpg";

  // Create output directory
  const inputName = basename(inputPath, extname(inputPath));
  const outputDir = options.output || join(dirname(inputPath), `${inputName}-frames`);
  await execAsync(`mkdir -p "${outputDir}"`);

  let extractedCount = 0;
  const outputPaths: string[] = [];

  if (options.timestamps && options.timestamps.length > 0) {
    // Extract frames at specific timestamps
    for (let i = 0; i < options.timestamps.length; i++) {
      const ts = options.timestamps[i];
      const outPath = join(outputDir, `frame-${ts.replace(/:/g, "-")}.${format}`);
      await execAsync(`${FFMPEG} -y -ss ${ts} -i "${inputPath}" -vframes 1 -q:v 2 "${outPath}"`);
      outputPaths.push(outPath);
      extractedCount++;
    }
  } else if (options.count) {
    // Extract N frames evenly distributed
    const interval = info.duration / (options.count + 1);
    for (let i = 1; i <= options.count; i++) {
      const ts = interval * i;
      const outPath = join(outputDir, `frame-${i.toString().padStart(3, "0")}.${format}`);
      await execAsync(`${FFMPEG} -y -ss ${ts} -i "${inputPath}" -vframes 1 -q:v 2 "${outPath}"`);
      outputPaths.push(outPath);
      extractedCount++;
    }
  } else {
    // Extract frames at interval (default: every 10 seconds)
    const interval = options.interval || 10;
    let ts = 0;
    let frameNum = 1;
    while (ts < info.duration) {
      const outPath = join(outputDir, `frame-${frameNum.toString().padStart(3, "0")}.${format}`);
      await execAsync(`${FFMPEG} -y -ss ${ts} -i "${inputPath}" -vframes 1 -q:v 2 "${outPath}"`);
      outputPaths.push(outPath);
      extractedCount++;
      ts += interval;
      frameNum++;
    }
  }

  return `**Frames Extracted**

**Input:** ${basename(inputPath)} (${formatDuration(info.duration)})
**Output:** ${outputDir}
**Frames:** ${extractedCount}
**Format:** ${format.toUpperCase()}
**Files:**
${outputPaths.slice(0, 10).map(p => `  - ${basename(p)}`).join("\n")}${outputPaths.length > 10 ? `\n  ... and ${outputPaths.length - 10} more` : ""}`;
}

async function videoThumbnail(
  input: string,
  options: { time?: string; output?: string }
): Promise<string> {
  const inputPath = await resolveInputPath(input);
  const info = await getVideoInfo(inputPath);

  // Default to 10% into the video for thumbnail
  const time = options.time || (info.duration * 0.1).toString();
  const inputName = basename(inputPath, extname(inputPath));
  const outputPath = options.output || join(dirname(inputPath), `${inputName}-thumb.jpg`);

  await execAsync(`${FFMPEG} -y -ss ${time} -i "${inputPath}" -vframes 1 -q:v 2 "${outputPath}"`);

  const stat = statSync(outputPath);

  return `**Thumbnail Created**

**Input:** ${basename(inputPath)}
**Output:** ${outputPath}
**Time:** ${time}s
**Size:** ${formatBytes(stat.size)}`;
}

async function videoConcat(
  inputs: string[],
  options: { output?: string }
): Promise<string> {
  const inputPaths = await Promise.all(inputs.map(resolveInputPath));

  const tempDir = join(dirname(inputPaths[0]), ".concat-temp");
  await execAsync(`mkdir -p "${tempDir}"`);

  // Convert all to ts format for concatenation
  const tsPaths: string[] = [];
  for (let i = 0; i < inputPaths.length; i++) {
    const tsPath = join(tempDir, `part${i.toString().padStart(3, "0")}.ts`);
    tsPaths.push(tsPath);
    await execAsync(
      `${FFMPEG} -y -i "${inputPaths[i]}" -c copy -bsf:v h264_mp4toannexb -f mpegts "${tsPath}"`
    );
  }

  // Create concat file
  const concatFile = join(tempDir, "concat.txt");
  const concatContent = tsPaths.map(p => `file '${p}'`).join("\n");
  await execAsync(`echo '${concatContent}' > "${concatFile}"`);

  // Concatenate
  const outputPath = options.output || getOutputPath(inputPaths[0], "-merged");
  await execAsync(
    `${FFMPEG} -y -f concat -safe 0 -i "${concatFile}" -c copy "${outputPath}"`
  );

  // Cleanup
  await execAsync(`rm -rf "${tempDir}"`);

  const outputInfo = await getVideoInfo(outputPath);

  return `**Concatenated Videos**

**Inputs:** ${inputPaths.length} files
${inputPaths.map(p => `  - ${basename(p)}`).join("\n")}
**Output:** ${outputPath}
**Duration:** ${formatDuration(outputInfo.duration)}
**Size:** ${formatBytes(outputInfo.size)}`;
}

// =============================================================================
// MCP SERVER
// =============================================================================

const server = new Server(
  { name: "video-editor", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "video_info",
      description: "Get detailed information about a video file (duration, resolution, codec, bitrate, size)",
      inputSchema: {
        type: "object",
        properties: {
          input: { type: "string", description: "Path to the video file" },
        },
        required: ["input"],
      },
    },
    {
      name: "video_trim",
      description: "Trim a video - extract a portion by start/end time, duration, or last N seconds",
      inputSchema: {
        type: "object",
        properties: {
          input: { type: "string", description: "Path to the video file" },
          start: { type: "string", description: "Start time (HH:MM:SS or seconds)" },
          end: { type: "string", description: "End time (HH:MM:SS or seconds)" },
          duration: { type: "string", description: "Duration to extract (HH:MM:SS or seconds)" },
          last: { type: "number", description: "Extract last N seconds from end of video" },
          output: { type: "string", description: "Output file path (optional)" },
        },
        required: ["input"],
      },
    },
    {
      name: "video_speed",
      description: "Change video playback speed - speed up or slow down. Can specify speed multiplier (e.g., 2 for 2x) or target duration",
      inputSchema: {
        type: "object",
        properties: {
          input: { type: "string", description: "Path to the video file" },
          speed: { type: "number", description: "Speed multiplier (e.g., 2 for 2x faster, 0.5 for half speed)" },
          targetDuration: { type: "number", description: "Target duration in seconds (calculates speed automatically)" },
          output: { type: "string", description: "Output file path (optional)" },
        },
        required: ["input"],
      },
    },
    {
      name: "video_extract_audio",
      description: "Extract audio track from a video file",
      inputSchema: {
        type: "object",
        properties: {
          input: { type: "string", description: "Path to the video file" },
          format: { type: "string", description: "Audio format: mp3, aac, wav, flac, ogg (default: mp3)" },
          output: { type: "string", description: "Output file path (optional)" },
        },
        required: ["input"],
      },
    },
    {
      name: "video_remove_silence",
      description: "Automatically detect and remove silent segments from a video",
      inputSchema: {
        type: "object",
        properties: {
          input: { type: "string", description: "Path to the video file" },
          threshold: { type: "string", description: "Silence threshold in dB (default: -30dB). Lower = more aggressive" },
          minDuration: { type: "number", description: "Minimum silence duration in seconds to remove (default: 0.5)" },
          padding: { type: "number", description: "Seconds of padding around cuts (default: 0.1)" },
          output: { type: "string", description: "Output file path (optional)" },
        },
        required: ["input"],
      },
    },
    {
      name: "video_resize",
      description: "Resize video resolution - by dimensions or scale factor",
      inputSchema: {
        type: "object",
        properties: {
          input: { type: "string", description: "Path to the video file" },
          width: { type: "number", description: "Target width in pixels" },
          height: { type: "number", description: "Target height in pixels" },
          scale: { type: "number", description: "Scale factor (e.g., 0.5 for half size)" },
          output: { type: "string", description: "Output file path (optional)" },
        },
        required: ["input"],
      },
    },
    {
      name: "video_compress",
      description: "Compress video to reduce file size using H.264 encoding",
      inputSchema: {
        type: "object",
        properties: {
          input: { type: "string", description: "Path to the video file" },
          crf: { type: "number", description: "Quality (0-51, lower=better, default: 28). 18=visually lossless, 28=good compression" },
          preset: { type: "string", description: "Encoding speed: ultrafast, superfast, veryfast, faster, fast, medium, slow, slower, veryslow" },
          maxBitrate: { type: "string", description: "Maximum bitrate (e.g., '5M' for 5 Mbps)" },
          output: { type: "string", description: "Output file path (optional)" },
        },
        required: ["input"],
      },
    },
    {
      name: "video_concat",
      description: "Concatenate multiple videos into one",
      inputSchema: {
        type: "object",
        properties: {
          inputs: {
            type: "array",
            items: { type: "string" },
            description: "Array of video file paths to concatenate",
          },
          output: { type: "string", description: "Output file path (optional)" },
        },
        required: ["inputs"],
      },
    },
    {
      name: "video_frames",
      description: "Extract frames from a video - at intervals, specific timestamps, or evenly distributed count",
      inputSchema: {
        type: "object",
        properties: {
          input: { type: "string", description: "Path to the video file" },
          interval: { type: "number", description: "Extract a frame every N seconds (default: 10)" },
          count: { type: "number", description: "Extract exactly N frames, evenly distributed" },
          timestamps: {
            type: "array",
            items: { type: "string" },
            description: "Extract frames at specific timestamps (e.g., ['00:01:30', '00:05:00'])",
          },
          format: { type: "string", description: "Image format: jpg, png, webp (default: jpg)" },
          output: { type: "string", description: "Output directory (optional)" },
        },
        required: ["input"],
      },
    },
    {
      name: "video_thumbnail",
      description: "Extract a single thumbnail image from a video",
      inputSchema: {
        type: "object",
        properties: {
          input: { type: "string", description: "Path to the video file" },
          time: { type: "string", description: "Timestamp to capture (default: 10% into video)" },
          output: { type: "string", description: "Output file path (optional)" },
        },
        required: ["input"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let result: string;

    switch (name) {
      case "video_info":
        result = await videoInfo(args?.input as string);
        break;
      case "video_trim":
        result = await videoTrim(args?.input as string, {
          start: args?.start as string,
          end: args?.end as string,
          duration: args?.duration as string,
          last: args?.last as number,
          output: args?.output as string,
        });
        break;
      case "video_speed":
        result = await videoSpeed(args?.input as string, {
          speed: args?.speed as number,
          targetDuration: args?.targetDuration as number,
          output: args?.output as string,
        });
        break;
      case "video_extract_audio":
        result = await videoExtractAudio(args?.input as string, {
          format: args?.format as string,
          output: args?.output as string,
        });
        break;
      case "video_remove_silence":
        result = await videoRemoveSilence(args?.input as string, {
          threshold: args?.threshold as string,
          minDuration: args?.minDuration as number,
          padding: args?.padding as number,
          output: args?.output as string,
        });
        break;
      case "video_resize":
        result = await videoResize(args?.input as string, {
          width: args?.width as number,
          height: args?.height as number,
          scale: args?.scale as number,
          output: args?.output as string,
        });
        break;
      case "video_compress":
        result = await videoCompress(args?.input as string, {
          crf: args?.crf as number,
          preset: args?.preset as string,
          maxBitrate: args?.maxBitrate as string,
          output: args?.output as string,
        });
        break;
      case "video_concat":
        result = await videoConcat(args?.inputs as string[], {
          output: args?.output as string,
        });
        break;
      case "video_frames":
        result = await videoFrames(args?.input as string, {
          interval: args?.interval as number,
          count: args?.count as number,
          timestamps: args?.timestamps as string[],
          format: args?.format as string,
          output: args?.output as string,
        });
        break;
      case "video_thumbnail":
        result = await videoThumbnail(args?.input as string, {
          time: args?.time as string,
          output: args?.output as string,
        });
        break;
      default:
        return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
    }

    return { content: [{ type: "text", text: result }] };
  } catch (error: any) {
    return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
  }
});

// =============================================================================
// EXPORTS (for API usage)
// =============================================================================

export {
  videoInfo,
  videoTrim,
  videoSpeed,
  videoExtractAudio,
  videoRemoveSilence,
  videoResize,
  videoCompress,
  videoConcat,
  videoFrames,
  videoThumbnail,
  getVideoInfo,
};

// =============================================================================
// ENTRY POINT
// =============================================================================

const args = process.argv.slice(2);
const commands = ["info", "trim", "speed", "audio", "silence", "resize", "compress", "concat", "frames", "thumbnail", "help"];

function parseArgs(args: string[]): Record<string, any> {
  const opts: Record<string, any> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        opts[key] = isNaN(Number(next)) ? next : Number(next);
        i++;
      } else {
        opts[key] = true;
      }
    } else if (!opts.input) {
      opts.input = arg;
    }
  }
  return opts;
}

function printHelp() {
  console.log(`
Video Editor CLI

Usage: video-editor <command> <input> [options]

Commands:
  info <video>                    Get video information
  trim <video> [options]          Trim video
    --start <time>                Start time (HH:MM:SS or seconds)
    --end <time>                  End time
    --duration <time>             Duration to extract
    --last <seconds>              Extract last N seconds
  speed <video> [options]         Change playback speed
    --speed <multiplier>          Speed multiplier (e.g., 2 for 2x)
    --target <seconds>            Target duration in seconds
  audio <video> [options]         Extract audio
    --format <fmt>                Format: mp3, aac, wav, flac, ogg
  silence <video> [options]       Remove silent segments
    --threshold <dB>              Silence threshold (default: -30dB)
    --min <seconds>               Min silence duration (default: 0.5)
    --padding <seconds>           Padding around cuts (default: 0.1)
  resize <video> [options]        Resize video
    --width <pixels>              Target width
    --height <pixels>             Target height
    --scale <factor>              Scale factor (e.g., 0.5)
  compress <video> [options]      Compress video
    --crf <0-51>                  Quality (lower=better, default: 28)
    --preset <preset>             Speed: ultrafast to veryslow
  concat <video1> <video2> ...    Concatenate videos
  frames <video> [options]        Extract frames as images
    --interval <seconds>          Extract every N seconds (default: 10)
    --count <n>                   Extract exactly N frames, evenly spaced
    --format <fmt>                Image format: jpg, png, webp
  thumbnail <video> [options]     Extract single thumbnail
    --time <timestamp>            Time to capture (default: 10% in)

Common options:
  --output <path>                 Output file path

Examples:
  video-editor info recording.mov
  video-editor trim recording.mov --last 120
  video-editor speed recording.mov --target 120
  video-editor silence podcast.mp4 --threshold -25dB
  video-editor compress raw.mov --crf 23 --preset fast
`);
}

// CLI mode
if (args.length > 0 && commands.includes(args[0])) {
  const command = args[0];
  const opts = parseArgs(args.slice(1));

  (async () => {
    try {
      let result: string;

      switch (command) {
        case "help":
          printHelp();
          process.exit(0);
        case "info":
          result = await videoInfo(opts.input);
          break;
        case "trim":
          result = await videoTrim(opts.input, opts);
          break;
        case "speed":
          result = await videoSpeed(opts.input, {
            speed: opts.speed,
            targetDuration: opts.target,
            output: opts.output,
          });
          break;
        case "audio":
          result = await videoExtractAudio(opts.input, opts);
          break;
        case "silence":
          result = await videoRemoveSilence(opts.input, {
            threshold: opts.threshold,
            minDuration: opts.min,
            padding: opts.padding,
            output: opts.output,
          });
          break;
        case "resize":
          result = await videoResize(opts.input, opts);
          break;
        case "compress":
          result = await videoCompress(opts.input, opts);
          break;
        case "concat":
          // For concat, all non-flag args are inputs
          const inputs = args.slice(1).filter(a => !a.startsWith("--"));
          result = await videoConcat(inputs, { output: opts.output });
          break;
        case "frames":
          result = await videoFrames(opts.input, {
            interval: opts.interval,
            count: opts.count,
            format: opts.format,
            output: opts.output,
          });
          break;
        case "thumbnail":
          result = await videoThumbnail(opts.input, {
            time: opts.time,
            output: opts.output,
          });
          break;
        default:
          printHelp();
          process.exit(1);
      }

      console.log(result);
    } catch (error: any) {
      console.error("Error:", error.message);
      process.exit(1);
    }
  })();
}
// MCP mode (no args or piped input)
else if (args.length === 0 || args[0] === "--mcp") {
  const transport = new StdioServerTransport();
  server.connect(transport).catch(console.error);
}
// Unknown - show help
else {
  printHelp();
}
