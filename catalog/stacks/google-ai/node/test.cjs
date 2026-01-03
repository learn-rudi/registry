#!/usr/bin/env node
/**
 * Test script for Google AI TypeScript MCP
 * Tests image generation with nano-banana model
 */
const { spawn } = require("child_process");
const { join } = require("path");
const { existsSync, mkdirSync } = require("fs");
const { config } = require("dotenv");
config();

const OUTPUT_DIR = join(__dirname, "output");
const SCRIPTS_DIR = join(__dirname, "..", "google-ai-studio", "src", "commands");

if (!existsSync(OUTPUT_DIR)) {
  mkdirSync(OUTPUT_DIR, { recursive: true });
}

function runCommand(cmd, args, cwd) {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { cwd, env: process.env });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (data) => (stdout += data.toString()));
    proc.stderr.on("data", (data) => (stderr += data.toString()));
    proc.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

async function test() {
  console.log("=== Google AI TS MCP Test ===\n");

  if (!process.env.GOOGLE_AI_API_KEY) {
    console.log("⚠ GOOGLE_AI_API_KEY not set - skipping generation test");
    console.log("  Set the key in .env to test image/video generation\n");
    return;
  }

  console.log("1. Test Image Generation (nano-banana):");
  const timestamp = new Date().toISOString().replace(/[-:]/g, "").split(".")[0];
  const output = join(OUTPUT_DIR, `test_${timestamp}.png`);

  const scriptPath = join(SCRIPTS_DIR, "generateImage.js");
  if (!existsSync(scriptPath)) {
    console.log(`   ⚠ Script not found: ${scriptPath}`);
    console.log("   Make sure google-ai-studio is in the parent directory");
    return;
  }

  console.log("   Generating: 'A simple blue circle on white background'");
  const result = await runCommand(
    "node",
    [scriptPath, "A simple blue circle on white background", "--model", "nano-banana", "--output", output],
    join(__dirname, "..", "google-ai-studio")
  );

  if (result.code === 0 && existsSync(output)) {
    console.log(`   ✓ Image saved to: ${output}`);
  } else {
    console.log(`   ✗ Generation failed: ${result.stderr || result.stdout}`);
  }

  console.log("\n✓ Test complete!");
}

test().catch(console.error);
