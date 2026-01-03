#!/usr/bin/env node
/**
 * Google AI (Gemini/Imagen/Veo) MCP Server - Standalone TypeScript Implementation
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { config } from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { mkdirSync, existsSync, writeFileSync, createWriteStream, unlinkSync } from "fs";
import https from "https";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, "..", ".env") });

// =============================================================================
// CONSTANTS
// =============================================================================

const API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

const RESPONSE_MODALITIES = {
  TEXT: "TEXT",
  IMAGE: "IMAGE",
};

const POLLING_CONFIG = {
  INTERVAL_MS: 5000,
  MAX_ATTEMPTS: 60,
};

// =============================================================================
// MODEL CONFIGURATION
// =============================================================================

interface ModelConfig {
  id: string;
  name: string;
  type: "GEMINI_IMAGE" | "IMAGEN" | "VEO_VIDEO";
  endpoint: string;
}

const MODELS: Record<string, ModelConfig> = {
  "nano-banana": {
    id: "gemini-2.5-flash-image",
    name: "Nano Banana",
    type: "GEMINI_IMAGE",
    endpoint: "generateContent",
  },
  "nano-banana-pro": {
    id: "gemini-3-pro-image-preview",
    name: "Nano Banana Pro",
    type: "GEMINI_IMAGE",
    endpoint: "generateContent",
  },
  "imagen4-ultra": {
    id: "imagen-4.0-ultra-generate-001",
    name: "Imagen 4 Ultra",
    type: "IMAGEN",
    endpoint: "predict",
  },
  "imagen4-standard": {
    id: "imagen-4.0-generate-001",
    name: "Imagen 4 Standard",
    type: "IMAGEN",
    endpoint: "predict",
  },
  "imagen4-fast": {
    id: "imagen-4.0-fast-generate-001",
    name: "Imagen 4 Fast",
    type: "IMAGEN",
    endpoint: "predict",
  },
  "veo-standard": {
    id: "veo-3.1-generate-preview",
    name: "Veo 3.1 Standard",
    type: "VEO_VIDEO",
    endpoint: "predictLongRunning",
  },
  "veo-fast": {
    id: "veo-3.1-fast-generate-preview",
    name: "Veo 3.1 Fast",
    type: "VEO_VIDEO",
    endpoint: "predictLongRunning",
  },
};

// =============================================================================
// OUTPUT DIRECTORY - Default: ~/.prompt-stack/output/
// =============================================================================

import { homedir } from "os";

const DEFAULT_OUTPUT_DIR = join(homedir(), ".prompt-stack", "output");
if (!existsSync(DEFAULT_OUTPUT_DIR)) {
  mkdirSync(DEFAULT_OUTPUT_DIR, { recursive: true });
}

// =============================================================================
// API KEY
// =============================================================================

function getApiKey(): string {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GOOGLE_AI_API_KEY not found.\n" +
      "For Prompt Stack: Add in Settings → Cloud & Secrets → Google AI → Connect\n" +
      "For local dev: Add to .env file\n" +
      "Get your key: https://makersuite.google.com/app/apikey"
    );
  }
  return apiKey;
}

// =============================================================================
// API CLIENT
// =============================================================================

async function makeRequest(url: string, body: object, apiKey: string): Promise<any> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error?.message || `HTTP ${response.status}`);
  }

  return response.json();
}

// =============================================================================
// FILE UTILITIES
// =============================================================================

function saveBase64Image(base64Data: string, outputPath: string): { path: string; sizeMB: string } {
  const buffer = Buffer.from(base64Data, "base64");
  writeFileSync(outputPath, buffer);
  return {
    path: outputPath,
    sizeMB: (buffer.length / 1024 / 1024).toFixed(2),
  };
}

async function downloadFile(
  url: string,
  outputPath: string,
  apiKey: string
): Promise<{ path: string; sizeMB: string }> {
  return new Promise((resolve, reject) => {
    let redirectCount = 0;
    const maxRedirects = 5;

    const download = (downloadUrl: string) => {
      const urlWithAuth = downloadUrl.includes("generativelanguage.googleapis.com")
        ? (downloadUrl.includes("?") ? `${downloadUrl}&key=${apiKey}` : `${downloadUrl}?key=${apiKey}`)
        : downloadUrl;

      https.get(urlWithAuth, (response) => {
        if ([301, 302, 307, 308].includes(response.statusCode || 0)) {
          if (++redirectCount > maxRedirects) {
            return reject(new Error("Too many redirects"));
          }
          return download(response.headers.location || "");
        }

        if (response.statusCode !== 200) {
          return reject(new Error(`HTTP ${response.statusCode}`));
        }

        const fileStream = createWriteStream(outputPath);
        let sizeBytes = 0;

        response.on("data", (chunk) => (sizeBytes += chunk.length));
        response.pipe(fileStream);

        fileStream.on("finish", () => {
          fileStream.close();
          resolve({
            path: outputPath,
            sizeMB: (sizeBytes / 1024 / 1024).toFixed(2),
          });
        });

        fileStream.on("error", (err) => {
          unlinkSync(outputPath);
          reject(new Error(`Write error: ${err.message}`));
        });
      }).on("error", (err) => reject(new Error(`Network error: ${err.message}`)));
    };

    download(url);
  });
}

// =============================================================================
// POLLING FOR VIDEO GENERATION
// =============================================================================

async function pollOperation(operationUrl: string, apiKey: string): Promise<any> {
  const { INTERVAL_MS, MAX_ATTEMPTS } = POLLING_CONFIG;
  let attempts = 0;

  while (attempts < MAX_ATTEMPTS) {
    attempts++;
    await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));

    const response = await fetch(operationUrl, {
      headers: { "x-goog-api-key": apiKey },
    });

    if (!response.ok) continue;

    const result = await response.json();
    if (result.done === true) {
      return result;
    }
  }

  throw new Error(`Operation timed out after ${MAX_ATTEMPTS * (INTERVAL_MS / 1000)}s`);
}

function extractVideoUri(pollResult: any): string | null {
  return pollResult.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri || null;
}

// =============================================================================
// IMAGE GENERATION
// =============================================================================

async function generateGeminiImage(
  modelId: string,
  prompt: string,
  aspectRatio: string,
  outputPath: string,
  apiKey: string
): Promise<{ path: string; sizeMB: string }> {
  const url = `${API_BASE_URL}/models/${modelId}:generateContent`;

  const body: any = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      responseModalities: [RESPONSE_MODALITIES.TEXT, RESPONSE_MODALITIES.IMAGE],
    },
  };

  if (aspectRatio) {
    body.generationConfig.imageConfig = { aspectRatio };
  }

  const result = await makeRequest(url, body, apiKey);

  const imagePart = result.candidates?.[0]?.content?.parts?.find((part: any) => part.inlineData);
  if (!imagePart) {
    throw new Error("No image data in response");
  }

  return saveBase64Image(imagePart.inlineData.data, outputPath);
}

async function generateImagenImage(
  modelId: string,
  prompt: string,
  aspectRatio: string,
  outputPath: string,
  apiKey: string
): Promise<{ path: string; sizeMB: string }> {
  const url = `${API_BASE_URL}/models/${modelId}:predict`;

  const body: any = {
    instances: [{ prompt }],
    parameters: { sampleCount: 1 },
  };

  if (aspectRatio) {
    body.parameters.aspectRatio = aspectRatio;
  }

  const result = await makeRequest(url, body, apiKey);

  if (!result.predictions || result.predictions.length === 0) {
    throw new Error("No predictions in response");
  }

  return saveBase64Image(result.predictions[0].bytesBase64Encoded, outputPath);
}

// =============================================================================
// VIDEO GENERATION
// =============================================================================

async function generateVideo(
  modelId: string,
  prompt: string,
  aspectRatio: string,
  outputPath: string,
  apiKey: string
): Promise<{ path: string; sizeMB: string }> {
  const url = `${API_BASE_URL}/models/${modelId}:predictLongRunning`;

  const body = {
    instances: [{ prompt }],
    parameters: { aspectRatio },
  };

  const startResult = await makeRequest(url, body, apiKey);

  if (!startResult.name) {
    throw new Error("No operation name in response");
  }

  const operationUrl = `${API_BASE_URL}/${startResult.name}`;
  const pollResult = await pollOperation(operationUrl, apiKey);

  const videoUri = extractVideoUri(pollResult);
  if (!videoUri) {
    throw new Error("No video URI in completed operation");
  }

  return downloadFile(videoUri, outputPath, apiKey);
}

// =============================================================================
// HELPERS
// =============================================================================

function generateTimestamp(): string {
  const now = new Date();
  return now.toISOString().replace(/[-:]/g, "").replace("T", "_").split(".")[0];
}

function safeFilename(prompt: string): string {
  return prompt.slice(0, 30).replace(/[^a-zA-Z0-9]/g, "_");
}

// =============================================================================
// EXPORTED API FUNCTIONS - For direct script usage
// =============================================================================

export interface GenerateImageOptions {
  prompt: string;
  model?: "nano-banana" | "nano-banana-pro" | "imagen4-fast" | "imagen4-standard" | "imagen4-ultra";
  aspect?: "1:1" | "3:4" | "4:3" | "9:16" | "16:9";
  output?: string;
}

export interface GenerateVideoOptions {
  prompt: string;
  fast?: boolean;
  output?: string;
}

export interface GenerateResult {
  path: string;
  sizeMB: string;
  model: string;
  prompt: string;
}

export async function generateImage(options: GenerateImageOptions): Promise<GenerateResult> {
  const apiKey = getApiKey();
  const { prompt, model: modelKey = "nano-banana", aspect = "16:9" } = options;

  const model = MODELS[modelKey];
  if (!model) throw new Error(`Unknown model: ${modelKey}`);

  let output = options.output;
  if (!output) {
    const timestamp = generateTimestamp();
    const safePrompt = safeFilename(prompt);
    output = join(DEFAULT_OUTPUT_DIR, `${safePrompt}_${timestamp}.png`);
  }

  const outputDir = dirname(output);
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  let result;
  if (model.type === "GEMINI_IMAGE") {
    result = await generateGeminiImage(model.id, prompt, aspect, output, apiKey);
  } else {
    result = await generateImagenImage(model.id, prompt, aspect, output, apiKey);
  }

  return { ...result, model: model.name, prompt };
}

export async function generateVideoAPI(options: GenerateVideoOptions): Promise<GenerateResult> {
  const apiKey = getApiKey();
  const { prompt, fast = false } = options;

  const model = fast ? MODELS["veo-fast"] : MODELS["veo-standard"];

  let output = options.output;
  if (!output) {
    const timestamp = generateTimestamp();
    const safePrompt = safeFilename(prompt);
    output = join(DEFAULT_OUTPUT_DIR, `${safePrompt}_${timestamp}.mp4`);
  }

  const outputDir = dirname(output);
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  const result = await generateVideo(model.id, prompt, "16:9", output, apiKey);
  return { ...result, model: model.name, prompt };
}

// =============================================================================
// MCP SERVER
// =============================================================================

const server = new Server(
  { name: "google-ai", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "generate_image",
      description: "Generate an image using Google AI (Gemini/Imagen). Returns the file path of the generated image.",
      inputSchema: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "Text description of the image to generate" },
          model: {
            type: "string",
            description: "Model to use: nano-banana (fast), nano-banana-pro (quality), imagen4-fast, imagen4-standard, imagen4-ultra (best)",
            enum: ["nano-banana", "nano-banana-pro", "imagen4-fast", "imagen4-standard", "imagen4-ultra"],
            default: "nano-banana",
          },
          aspect: {
            type: "string",
            description: "Aspect ratio",
            enum: ["1:1", "3:4", "4:3", "9:16", "16:9"],
            default: "16:9",
          },
          output: { type: "string", description: "Output file path (optional, auto-generated if not provided)" },
        },
        required: ["prompt"],
      },
    },
    {
      name: "generate_video",
      description: "Generate a video using Google AI (Veo). Returns the file path of the generated video.",
      inputSchema: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "Text description of the video to generate" },
          fast: { type: "boolean", description: "Use fast generation mode", default: false },
          output: { type: "string", description: "Output file path (optional, auto-generated if not provided)" },
        },
        required: ["prompt"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    const apiKey = getApiKey();

    switch (name) {
      case "generate_image": {
        const prompt = args?.prompt as string;
        const modelKey = (args?.model as string) || "nano-banana";
        const aspect = (args?.aspect as string) || "16:9";

        const model = MODELS[modelKey];
        if (!model) {
          throw new Error(`Unknown model: ${modelKey}`);
        }

        let output = args?.output as string;
        if (!output) {
          const timestamp = generateTimestamp();
          const safePrompt = safeFilename(prompt);
          output = join(DEFAULT_OUTPUT_DIR, `${safePrompt}_${timestamp}.png`);
        }

        // Ensure output directory exists
        const outputDir = dirname(output);
        if (!existsSync(outputDir)) {
          mkdirSync(outputDir, { recursive: true });
        }

        let result;
        if (model.type === "GEMINI_IMAGE") {
          result = await generateGeminiImage(model.id, prompt, aspect, output, apiKey);
        } else {
          result = await generateImagenImage(model.id, prompt, aspect, output, apiKey);
        }

        return {
          content: [{
            type: "text",
            text: `Image generated successfully!\nFile: ${result.path}\nModel: ${model.name}\nSize: ${result.sizeMB}MB\nPrompt: ${prompt}`,
          }],
        };
      }

      case "generate_video": {
        const prompt = args?.prompt as string;
        const fast = (args?.fast as boolean) || false;

        const model = fast ? MODELS["veo-fast"] : MODELS["veo-standard"];

        let output = args?.output as string;
        if (!output) {
          const timestamp = generateTimestamp();
          const safePrompt = safeFilename(prompt);
          output = join(DEFAULT_OUTPUT_DIR, `${safePrompt}_${timestamp}.mp4`);
        }

        // Ensure output directory exists
        const outputDir = dirname(output);
        if (!existsSync(outputDir)) {
          mkdirSync(outputDir, { recursive: true });
        }

        const result = await generateVideo(model.id, prompt, "16:9", output, apiKey);

        return {
          content: [{
            type: "text",
            text: `Video generated successfully!\nFile: ${result.path}\nModel: ${model.name}\nSize: ${result.sizeMB}MB\nPrompt: ${prompt}`,
          }],
        };
      }

      default:
        return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
    }
  } catch (error: any) {
    return {
      content: [{ type: "text", text: `Error: ${error.message}` }],
      isError: true,
    };
  }
});

async function runMCP() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Only start MCP server when run directly (not when imported)
const isMainModule = process.argv[1]?.includes("google-ai");
if (isMainModule && !process.argv.includes("--no-mcp")) {
  runMCP().catch(console.error);
}
