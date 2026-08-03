#!/usr/bin/env node
/**
 * OpenAI MCP
 * GPT Image 1.5 generation, GPT-4o Transcribe, GPT-4o mini TTS, Sora 2 video
 *
 * Usage:
 *   - As MCP: Run without args, speaks JSON-RPC
 *   - As API: import { generateImage, transcribeAudio, ... } from './index'
 *   - As CLI: node index.ts <command> [args]
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import OpenAI from "openai";
import { writeFileSync, readFileSync, existsSync, mkdirSync, statSync } from "fs";
import { config } from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join, basename } from "path";
import { homedir } from "os";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, "..", ".env") });

const DEFAULT_OUTPUT_DIR = join(homedir(), ".rudi", "outputs");

function ensureOutputDir() {
  if (!existsSync(DEFAULT_OUTPUT_DIR)) mkdirSync(DEFAULT_OUTPUT_DIR, { recursive: true });
}

function expandPath(p: string): string {
  if (p.startsWith("~/")) return join(homedir(), p.slice(2));
  return p;
}

function getClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not configured");
  return new OpenAI({ apiKey });
}

function generateFilename(prefix: string, ext: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return `${prefix}-${timestamp}.${ext}`;
}

// =============================================================================
// GPT IMAGE 1.5 - IMAGE GENERATION
// =============================================================================

export interface ImageResult {
  url?: string;
  localPath?: string;
  revisedPrompt?: string;
  model: string;
  size: string;
  quality: string;
}

export async function generateImage(
  prompt: string,
  options: {
    model?: "gpt-image-1.5" | "gpt-image-1" | "gpt-image-1-mini" | "dall-e-3" | "dall-e-2";
    size?: "1024x1024" | "1536x1024" | "1024x1536" | "1792x1024" | "1024x1792" | "auto";
    quality?: "low" | "medium" | "high" | "auto";
    background?: "transparent" | "opaque" | "auto";
    output?: string;
  } = {}
): Promise<ImageResult> {
  const client = getClient();
  const model = options.model || "gpt-image-1.5";
  const size = options.size || "auto";
  const quality = options.quality || "auto";

  const params: any = {
    model,
    prompt,
    n: 1,
    size,
  };

  // GPT Image models support quality and background, return b64_json by default
  if (model.startsWith("gpt-image")) {
    params.quality = quality;
    if (options.background) params.background = options.background;
    // Request URL for older models, but GPT Image returns b64_json
  } else if (model === "dall-e-3") {
    // DALL-E 3 uses different quality values and returns URL
    params.quality = quality === "high" ? "hd" : "standard";
    params.response_format = "url";
  } else {
    params.response_format = "url";
  }

  const response = await client.images.generate(params);
  const imageData = response.data?.[0];
  if (!imageData) {
    throw new Error("OpenAI image response did not include image data");
  }

  const result: ImageResult = {
    url: imageData.url,
    revisedPrompt: imageData.revised_prompt,
    model,
    size,
    quality,
  };

  // Save image - either from URL or base64
  if (options.output || imageData.b64_json) {
    ensureOutputDir();
    const outputPath = options.output ? expandPath(options.output) : DEFAULT_OUTPUT_DIR;
    const finalPath = outputPath.endsWith(".png")
      ? outputPath
      : existsSync(outputPath) && statSync(outputPath).isDirectory()
        ? join(outputPath, generateFilename("gpt-image", "png"))
        : options.output
          ? outputPath
          : join(DEFAULT_OUTPUT_DIR, generateFilename("gpt-image", "png"));

    let buffer: Buffer;
    if (imageData.b64_json) {
      // GPT Image models return base64
      buffer = Buffer.from(imageData.b64_json, "base64");
    } else if (imageData.url) {
      // DALL-E models return URL
      const imageResponse = await fetch(imageData.url);
      buffer = Buffer.from(await imageResponse.arrayBuffer());
    } else {
      throw new Error("No image data returned");
    }

    writeFileSync(finalPath, buffer);
    result.localPath = finalPath;
  }

  return result;
}

// =============================================================================
// GPT-4O TRANSCRIBE - SPEECH TO TEXT
// =============================================================================

export interface TranscriptionResult {
  text: string;
  duration?: number;
  language?: string;
  localPath?: string;
}

export async function transcribeAudio(
  audioPath: string,
  options: {
    model?: "gpt-4o-transcribe" | "gpt-4o-mini-transcribe" | "whisper-1";
    language?: string;
    prompt?: string;
    responseFormat?: "json" | "text" | "srt" | "verbose_json" | "vtt";
    output?: string;
  } = {}
): Promise<TranscriptionResult> {
  const client = getClient();
  const expandedPath = expandPath(audioPath);
  const model = options.model || "gpt-4o-transcribe";

  if (!existsSync(expandedPath)) {
    throw new Error(`Audio file not found: ${expandedPath}`);
  }

  const file = readFileSync(expandedPath);
  const blob = new Blob([file]);
  const audioFile = new File([blob], basename(expandedPath));

  const params: any = {
    file: audioFile,
    model,
  };

  if (options.language) params.language = options.language;
  if (options.prompt) params.prompt = options.prompt;
  if (options.responseFormat) params.response_format = options.responseFormat;

  const response = await client.audio.transcriptions.create(params);

  const responseRecord = typeof response === "string"
    ? undefined
    : response as { text?: unknown; duration?: unknown; language?: unknown };
  const responseText = typeof response === "string" ? response : responseRecord?.text;
  if (typeof responseText !== "string") {
    throw new Error("OpenAI transcription response did not include text");
  }
  const result: TranscriptionResult = { text: responseText };

  if (typeof responseRecord?.duration === "number") {
    result.duration = responseRecord.duration;
  }
  if (typeof responseRecord?.language === "string") {
    result.language = responseRecord.language;
  }

  // Save transcript if output specified
  if (options.output) {
    ensureOutputDir();
    const outputPath = expandPath(options.output);
    const finalPath = outputPath.includes(".")
      ? outputPath
      : existsSync(outputPath) && statSync(outputPath).isDirectory()
        ? join(outputPath, generateFilename("transcript", "txt"))
        : join(DEFAULT_OUTPUT_DIR, generateFilename("transcript", "txt"));

    writeFileSync(finalPath, result.text, "utf-8");
    result.localPath = finalPath;
  }

  return result;
}

// =============================================================================
// GPT-4O MINI TTS - TEXT TO SPEECH
// =============================================================================

export interface TTSResult {
  localPath: string;
  model: string;
  voice: string;
  format: string;
}

export async function textToSpeech(
  text: string,
  options: {
    model?: "gpt-4o-mini-tts" | "tts-1" | "tts-1-hd";
    voice?: "alloy" | "ash" | "ballad" | "coral" | "echo" | "fable" | "onyx" | "nova" | "sage" | "shimmer" | "verse";
    instructions?: string;
    speed?: number;
    responseFormat?: "mp3" | "opus" | "aac" | "flac" | "wav" | "pcm";
    output?: string;
  } = {}
): Promise<TTSResult> {
  const client = getClient();
  const model = options.model || "gpt-4o-mini-tts";
  const voice = options.voice || "alloy";
  const responseFormat = options.responseFormat || "mp3";

  const params: any = {
    model,
    voice,
    input: text,
    response_format: responseFormat,
  };

  // gpt-4o-mini-tts supports instructions for style control
  if (model === "gpt-4o-mini-tts" && options.instructions) {
    params.instructions = options.instructions;
  }

  if (options.speed) params.speed = options.speed;

  const response = await client.audio.speech.create(params);
  const buffer = Buffer.from(await response.arrayBuffer());

  ensureOutputDir();
  const outputPath = options.output ? expandPath(options.output) : DEFAULT_OUTPUT_DIR;
  const finalPath = outputPath.endsWith(`.${responseFormat}`)
    ? outputPath
    : existsSync(outputPath) && statSync(outputPath).isDirectory()
      ? join(outputPath, generateFilename("speech", responseFormat))
      : join(DEFAULT_OUTPUT_DIR, generateFilename("speech", responseFormat));

  writeFileSync(finalPath, buffer);

  return {
    localPath: finalPath,
    model,
    voice,
    format: responseFormat,
  };
}

// =============================================================================
// SORA 2 - VIDEO GENERATION
// =============================================================================

export interface VideoResult {
  id: string;
  status: string;
  url?: string;
  localPath?: string;
  model: string;
  duration: number;
  resolution: string;
}

export async function generateVideo(
  prompt: string,
  options: {
    model?: "sora-2" | "sora-2-pro";
    duration?: 4 | 8 | 12;
    resolution?: "720p" | "1080p";
    aspectRatio?: "16:9" | "9:16";
    output?: string;
  } = {}
): Promise<VideoResult> {
  const client = getClient();
  const model = options.model || "sora-2";
  const duration = options.duration || 4;
  const resolution = options.resolution || "720p";

  // Sora 2 API
  const response = await (client as any).videos.generate({
    model,
    prompt,
    duration,
    resolution,
    aspect_ratio: options.aspectRatio || "16:9",
  });

  const result: VideoResult = {
    id: response.id,
    status: response.status,
    url: response.url,
    model,
    duration,
    resolution,
  };

  // Download if complete and output specified
  if (response.url && options.output) {
    ensureOutputDir();
    const outputPath = expandPath(options.output);
    const finalPath = outputPath.endsWith(".mp4")
      ? outputPath
      : existsSync(outputPath) && statSync(outputPath).isDirectory()
        ? join(outputPath, generateFilename("sora", "mp4"))
        : join(DEFAULT_OUTPUT_DIR, generateFilename("sora", "mp4"));

    const videoResponse = await fetch(response.url);
    const buffer = Buffer.from(await videoResponse.arrayBuffer());
    writeFileSync(finalPath, buffer);
    result.localPath = finalPath;
  }

  return result;
}

// =============================================================================
// MCP SERVER
// =============================================================================

const server = new Server({ name: "openai", version: "1.0.0" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "generate_image",
      description: "Generate an image using GPT Image 1.5 (state-of-the-art) or other OpenAI image models. Supports transparent backgrounds and high quality output.",
      inputSchema: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "Text description of the image to generate (up to 32000 chars)" },
          model: {
            type: "string",
            enum: ["gpt-image-1.5", "gpt-image-1", "gpt-image-1-mini", "dall-e-3", "dall-e-2"],
            description: "Model to use (default: gpt-image-1.5, the latest)",
          },
          size: {
            type: "string",
            enum: ["1024x1024", "1536x1024", "1024x1536", "auto"],
            description: "Image size (default: auto). 1536x1024=landscape, 1024x1536=portrait",
          },
          quality: {
            type: "string",
            enum: ["low", "medium", "high", "auto"],
            description: "Image quality (default: auto). Higher = more detail, higher cost",
          },
          background: {
            type: "string",
            enum: ["transparent", "opaque", "auto"],
            description: "Background type for GPT Image models (default: auto)",
          },
          output: { type: "string", description: "Optional file path or directory to save the image" },
        },
        required: ["prompt"],
      },
    },
    {
      name: "transcribe_audio",
      description: "Transcribe audio to text using GPT-4o Transcribe (best accuracy) or Whisper. Improved word error rate and language recognition.",
      inputSchema: {
        type: "object",
        properties: {
          audio_path: { type: "string", description: "Path to the audio file (mp3, mp4, m4a, wav, webm)" },
          model: {
            type: "string",
            enum: ["gpt-4o-transcribe", "gpt-4o-mini-transcribe", "whisper-1"],
            description: "Model to use (default: gpt-4o-transcribe, best accuracy)",
          },
          language: { type: "string", description: "Language code (e.g., 'en', 'es', 'fr') for better accuracy" },
          prompt: { type: "string", description: "Optional prompt to guide transcription style" },
          response_format: {
            type: "string",
            enum: ["json", "text", "srt", "verbose_json", "vtt"],
            description: "Output format (default: json)",
          },
          output: { type: "string", description: "Optional file path to save transcript" },
        },
        required: ["audio_path"],
      },
    },
    {
      name: "text_to_speech",
      description: "Convert text to speech using GPT-4o mini TTS. Supports style instructions for customized speech (tone, emotion, pacing).",
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string", description: "Text to convert to speech" },
          model: {
            type: "string",
            enum: ["gpt-4o-mini-tts", "tts-1", "tts-1-hd"],
            description: "Model to use (default: gpt-4o-mini-tts, supports instructions)",
          },
          voice: {
            type: "string",
            enum: ["alloy", "ash", "ballad", "coral", "echo", "fable", "onyx", "nova", "sage", "shimmer", "verse"],
            description: "Voice to use (default: alloy)",
          },
          instructions: {
            type: "string",
            description: "Style instructions for gpt-4o-mini-tts (e.g., 'Speak slowly and calmly', 'Sound excited')",
          },
          speed: { type: "number", description: "Speed multiplier 0.25-4.0 (default: 1.0)" },
          response_format: {
            type: "string",
            enum: ["mp3", "opus", "aac", "flac", "wav", "pcm"],
            description: "Audio format (default: mp3)",
          },
          output: { type: "string", description: "Optional file path to save audio" },
        },
        required: ["text"],
      },
    },
    {
      name: "generate_video",
      description: "Generate a video with synced audio using Sora 2. Creates richly detailed, dynamic clips from text prompts.",
      inputSchema: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "Text description of the video to generate" },
          model: {
            type: "string",
            enum: ["sora-2", "sora-2-pro"],
            description: "Model (default: sora-2). sora-2-pro for production quality",
          },
          duration: { type: "number", enum: [4, 8, 12], description: "Video duration in seconds (default: 4)" },
          resolution: { type: "string", enum: ["720p", "1080p"], description: "Video resolution (default: 720p)" },
          aspect_ratio: { type: "string", enum: ["16:9", "9:16"], description: "Aspect ratio (default: 16:9)" },
          output: { type: "string", description: "Optional file path to save the video" },
        },
        required: ["prompt"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let result: any;

    switch (name) {
      case "generate_image": {
        result = await generateImage(args?.prompt as string, {
          model: args?.model as any,
          size: args?.size as any,
          quality: args?.quality as any,
          background: args?.background as any,
          output: args?.output as string,
        });
        const text = result.localPath
          ? `Image saved to: ${result.localPath}\nURL: ${result.url}${result.revisedPrompt ? `\nRevised prompt: ${result.revisedPrompt}` : ""}`
          : `Image URL: ${result.url}${result.revisedPrompt ? `\nRevised prompt: ${result.revisedPrompt}` : ""}`;
        return { content: [{ type: "text", text }] };
      }

      case "transcribe_audio": {
        result = await transcribeAudio(args?.audio_path as string, {
          model: args?.model as any,
          language: args?.language as string,
          prompt: args?.prompt as string,
          responseFormat: args?.response_format as any,
          output: args?.output as string,
        });
        const text = result.localPath
          ? `Transcript saved to: ${result.localPath}\n\n${result.text}`
          : result.text;
        return { content: [{ type: "text", text }] };
      }

      case "text_to_speech": {
        result = await textToSpeech(args?.text as string, {
          model: args?.model as any,
          voice: args?.voice as any,
          instructions: args?.instructions as string,
          speed: args?.speed as number,
          responseFormat: args?.response_format as any,
          output: args?.output as string,
        });
        return { content: [{ type: "text", text: `Audio saved to: ${result.localPath}\nModel: ${result.model}, Voice: ${result.voice}` }] };
      }

      case "generate_video": {
        result = await generateVideo(args?.prompt as string, {
          model: args?.model as any,
          duration: args?.duration as any,
          resolution: args?.resolution as any,
          aspectRatio: args?.aspect_ratio as any,
          output: args?.output as string,
        });
        const text = result.localPath
          ? `Video saved to: ${result.localPath}\nStatus: ${result.status}`
          : `Video ID: ${result.id}\nStatus: ${result.status}${result.url ? `\nURL: ${result.url}` : ""}`;
        return { content: [{ type: "text", text }] };
      }

      default:
        return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
    }
  } catch (error: any) {
    return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
  }
});

// =============================================================================
// CLI MODE
// =============================================================================

const cliArgs = process.argv.slice(2);

if (cliArgs.length > 0 && cliArgs[0] !== "--mcp") {
  const command = cliArgs[0];

  (async () => {
    try {
      switch (command) {
        case "image": {
          const prompt = cliArgs[1];
          if (!prompt) throw new Error("Usage: image <prompt> [output]");
          const result = await generateImage(prompt, { output: cliArgs[2] });
          console.log(result.localPath ? `Saved: ${result.localPath}` : `URL: ${result.url}`);
          break;
        }
        case "transcribe": {
          const audioPath = cliArgs[1];
          if (!audioPath) throw new Error("Usage: transcribe <audio_path> [output]");
          const result = await transcribeAudio(audioPath, { output: cliArgs[2] });
          console.log(result.text);
          break;
        }
        case "tts": {
          const text = cliArgs[1];
          if (!text) throw new Error("Usage: tts <text> [output]");
          const result = await textToSpeech(text, { output: cliArgs[2] });
          console.log(`Saved: ${result.localPath}`);
          break;
        }
        case "video": {
          const prompt = cliArgs[1];
          if (!prompt) throw new Error("Usage: video <prompt> [output]");
          const result = await generateVideo(prompt, { output: cliArgs[2] });
          console.log(result.localPath ? `Saved: ${result.localPath}` : `Status: ${result.status}`);
          break;
        }
        default:
          console.log("Commands: image, transcribe, tts, video");
      }
    } catch (error: any) {
      console.error("Error:", error.message);
      process.exit(1);
    }
  })();
} else {
  const transport = new StdioServerTransport();
  server.connect(transport).catch(console.error);
}
