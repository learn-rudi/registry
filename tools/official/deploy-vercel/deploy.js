#!/usr/bin/env node
/**
 * PROMPT STACK DEPLOYER (API Version)
 *
 * Deploys directly to Vercel using REST API.
 * No CLI required - just VERCEL_TOKEN from SecretsManager.
 *
 * Usage: node deploy.js [--project_path=/path] [--production]
 */

const fs = require('fs');
const path = require('path');

// =============================================================================
// CONFIG
// =============================================================================

const VERCEL_API = 'https://api.vercel.com';
const TOKEN = process.env.VERCEL_TOKEN;

// Files/folders to ignore
const IGNORE_PATTERNS = [
  'node_modules',
  '.git',
  '.next',
  'dist',
  '.venv',
  '__pycache__',
  '.DS_Store',
  'Thumbs.db',
  '.env.local',
  '.env',
  '*.log',
  '.vercel'
];

// =============================================================================
// ARGUMENT PARSING
// =============================================================================

const args = process.argv.slice(2);
const getArg = (name) => {
  const arg = args.find(a => a.startsWith(`--${name}=`));
  return arg ? arg.split('=').slice(1).join('=') : null;
};
const hasFlag = (name) => args.includes(`--${name}`);

const projectPath = getArg('project_path') || process.cwd();
// FLIPPED LOGIC: Default to production (public), use --preview for protected deployments
const isProduction = !hasFlag('preview');

// =============================================================================
// VALIDATION
// =============================================================================

if (!TOKEN) {
  console.error('❌ VERCEL_TOKEN not found.');
  console.error('');
  console.error('Add your token in:');
  console.error('  Prompt Stack → Settings → Cloud & Secrets → Vercel → Connect');
  console.error('');
  console.error('Get token: https://vercel.com/account/tokens');
  process.exit(1);
}

const fullPath = path.resolve(projectPath);
if (!fs.existsSync(fullPath)) {
  console.error(`❌ Project path not found: ${fullPath}`);
  process.exit(1);
}

// =============================================================================
// FILE COLLECTION
// =============================================================================

function shouldIgnore(filePath, basePath) {
  const relative = path.relative(basePath, filePath);
  const parts = relative.split(path.sep);

  for (const pattern of IGNORE_PATTERNS) {
    // Check each path segment
    for (const part of parts) {
      if (pattern.startsWith('*')) {
        // Wildcard pattern like *.log
        const ext = pattern.slice(1);
        if (part.endsWith(ext)) return true;
      } else if (part === pattern) {
        return true;
      }
    }
  }
  return false;
}

function collectFiles(dirPath, basePath, files = []) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullEntryPath = path.join(dirPath, entry.name);

    if (shouldIgnore(fullEntryPath, basePath)) {
      continue;
    }

    if (entry.isDirectory()) {
      collectFiles(fullEntryPath, basePath, files);
    } else if (entry.isFile()) {
      const relativePath = path.relative(basePath, fullEntryPath);
      const content = fs.readFileSync(fullEntryPath);

      files.push({
        file: relativePath,
        data: content.toString('base64'),
        encoding: 'base64'
      });
    }
  }

  return files;
}

// =============================================================================
// VERCEL API
// =============================================================================

async function createDeployment(files, projectName) {
  const body = {
    name: projectName,
    files: files,
    target: isProduction ? 'production' : undefined,
    projectSettings: {
      framework: null // Auto-detect
    }
  };

  const response = await fetch(`${VERCEL_API}/v13/deployments`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  return response.json();
}

async function waitForDeployment(deploymentId, maxWait = 120000) {
  const startTime = Date.now();

  while (Date.now() - startTime < maxWait) {
    const response = await fetch(`${VERCEL_API}/v13/deployments/${deploymentId}`, {
      headers: {
        'Authorization': `Bearer ${TOKEN}`
      }
    });

    const data = await response.json();

    if (data.readyState === 'READY') {
      return { success: true, data };
    } else if (data.readyState === 'ERROR') {
      return { success: false, error: data.errorMessage || 'Deployment failed' };
    }

    // Wait 2 seconds before polling again
    await new Promise(resolve => setTimeout(resolve, 2000));
    process.stdout.write('.');
  }

  return { success: false, error: 'Deployment timed out' };
}

// =============================================================================
// MAIN
// =============================================================================

async function deploy() {
  const projectName = path.basename(fullPath);

  console.log('');
  console.log('┌─────────────────────────────────────────┐');
  console.log('│       PROMPT STACK → VERCEL             │');
  console.log('└─────────────────────────────────────────┘');
  console.log('');
  console.log(`📁 Project:  ${projectName}`);
  console.log(`📂 Path:     ${fullPath}`);
  console.log(`🎯 Target:   ${isProduction ? 'Production' : 'Preview'}`);
  console.log('');

  // 1. Collect files
  console.log('📦 Collecting files...');
  const files = collectFiles(fullPath, fullPath);
  console.log(`   Found ${files.length} files`);

  // Calculate total size
  const totalSize = files.reduce((sum, f) => sum + Buffer.from(f.data, 'base64').length, 0);
  console.log(`   Total size: ${(totalSize / 1024 / 1024).toFixed(2)} MB`);
  console.log('');

  // 2. Create deployment
  console.log('🚀 Uploading to Vercel...');
  const result = await createDeployment(files, projectName);

  if (result.error) {
    console.error('');
    console.error(`❌ Deployment Failed: ${result.error.message || result.error.code}`);
    if (result.error.code === 'forbidden') {
      console.error('   Token may be invalid or expired. Check Settings → Cloud & Secrets.');
    }
    process.exit(1);
  }

  console.log('');
  console.log(`✅ Deployment created!`);
  console.log(`   ID: ${result.id}`);
  console.log('');

  // 3. Wait for build
  console.log('⏳ Building');
  const buildResult = await waitForDeployment(result.id);
  console.log('');

  if (!buildResult.success) {
    console.error(`❌ Build failed: ${buildResult.error}`);
    process.exit(1);
  }

  // 4. Success!
  console.log('');
  console.log('┌─────────────────────────────────────────┐');
  console.log('│            ✅ DEPLOYED!                 │');
  console.log('└─────────────────────────────────────────┘');
  console.log('');
  console.log(`🌍 URL:      https://${result.url}`);
  console.log(`🔍 Inspect:  ${result.inspectorUrl}`);

  if (isProduction && buildResult.data?.alias?.[0]) {
    console.log(`🏠 Prod:     https://${buildResult.data.alias[0]}`);
  }

  if (isProduction) {
    console.log('');
    console.log('✨ Production deployment - publicly accessible!');
  } else {
    console.log('');
    console.log('🔒 Preview deployment - requires authentication to view');
  }

  console.log('');

  // Output for agent parsing
  console.log('---DEPLOYMENT_RESULT---');
  console.log(JSON.stringify({
    success: true,
    url: `https://${result.url}`,
    inspectorUrl: result.inspectorUrl,
    projectName: projectName,
    target: isProduction ? 'production' : 'preview'
  }));
}

// Run
deploy().catch(error => {
  console.error('');
  console.error(`❌ Unexpected error: ${error.message}`);
  process.exit(1);
});
