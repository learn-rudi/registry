#!/usr/bin/env node
/**
 * PROMPT STACK - NEON DATABASE TOOL
 *
 * Creates serverless Postgres databases on Neon.
 * Returns a DATABASE_URL connection string ready to use.
 *
 * Usage: node create-db.js --name=my-app-db [--region=aws-us-east-1] [--write_env=/path/to/.env]
 */

const fs = require('fs');
const path = require('path');

// =============================================================================
// CONFIG
// =============================================================================

const NEON_API = 'https://console.neon.tech/api/v2';
const API_KEY = process.env.NEON_API_KEY;

const VALID_REGIONS = [
  'aws-us-east-1',
  'aws-us-east-2',
  'aws-us-west-2',
  'aws-eu-central-1',
  'aws-ap-southeast-1',
  'aws-ap-southeast-2'
];

// =============================================================================
// ARGUMENT PARSING
// =============================================================================

const args = process.argv.slice(2);
const getArg = (name) => {
  const arg = args.find(a => a.startsWith(`--${name}=`));
  return arg ? arg.split('=').slice(1).join('=') : null;
};

const projectName = getArg('name');
const region = getArg('region') || 'aws-us-east-1';
const writeEnvPath = getArg('write_env');

// =============================================================================
// VALIDATION
// =============================================================================

if (!API_KEY) {
  console.error('');
  console.error('❌ NEON_API_KEY not found.');
  console.error('');
  console.error('Add your API key in:');
  console.error('  Prompt Stack → Settings → Cloud & Secrets → Neon → Connect');
  console.error('');
  console.error('Get your key: https://console.neon.tech/app/settings/api-keys');
  process.exit(1);
}

if (!projectName) {
  console.error('');
  console.error('❌ Project name is required.');
  console.error('');
  console.error('Usage: node create-db.js --name=my-app-db');
  process.exit(1);
}

if (!VALID_REGIONS.includes(region)) {
  console.error('');
  console.error(`❌ Invalid region: ${region}`);
  console.error(`   Valid regions: ${VALID_REGIONS.join(', ')}`);
  process.exit(1);
}

// =============================================================================
// NEON API
// =============================================================================

async function createProject(name, region) {
  const response = await fetch(`${NEON_API}/projects`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify({
      project: {
        name: name,
        region_id: region,
        pg_version: 16
      }
    })
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || `API error: ${response.status}`);
  }

  return response.json();
}

// =============================================================================
// ENV FILE HELPER
// =============================================================================

function writeToEnvFile(envPath, connectionUri) {
  const fullPath = path.resolve(envPath);

  let content = '';
  try {
    content = fs.readFileSync(fullPath, 'utf-8');
  } catch {
    // File doesn't exist, we'll create it
  }

  // Check if DATABASE_URL already exists
  const lines = content.split('\n');
  const existingIndex = lines.findIndex(line => line.startsWith('DATABASE_URL='));

  if (existingIndex >= 0) {
    // Replace existing
    lines[existingIndex] = `DATABASE_URL="${connectionUri}"`;
    content = lines.join('\n');
  } else {
    // Append new
    if (content && !content.endsWith('\n')) {
      content += '\n';
    }
    content += `DATABASE_URL="${connectionUri}"\n`;
  }

  fs.writeFileSync(fullPath, content);
  return fullPath;
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  console.log('');
  console.log('┌─────────────────────────────────────────┐');
  console.log('│      PROMPT STACK → NEON POSTGRES       │');
  console.log('└─────────────────────────────────────────┘');
  console.log('');
  console.log(`🐘 Project:  ${projectName}`);
  console.log(`🌍 Region:   ${region}`);
  console.log('');

  // 1. Create the project
  console.log('⏳ Creating Neon project...');

  let result;
  try {
    result = await createProject(projectName, region);
  } catch (error) {
    console.error('');
    console.error(`❌ Failed to create project: ${error.message}`);
    if (error.message.includes('401') || error.message.includes('403')) {
      console.error('   Your API key may be invalid or expired.');
      console.error('   Check: Settings → Cloud & Secrets → Neon');
    }
    process.exit(1);
  }

  // 2. Extract connection info
  const project = result.project;
  const connectionUri = result.connection_uris?.[0]?.connection_uri;
  const host = result.endpoints?.[0]?.host;

  if (!connectionUri) {
    console.error('');
    console.error('❌ No connection URI returned from Neon.');
    console.error('   This is unexpected. Please try again.');
    process.exit(1);
  }

  // 3. Optionally write to .env
  if (writeEnvPath) {
    try {
      const writtenPath = writeToEnvFile(writeEnvPath, connectionUri);
      console.log(`📝 Wrote DATABASE_URL to: ${writtenPath}`);
    } catch (error) {
      console.warn(`⚠️  Could not write to ${writeEnvPath}: ${error.message}`);
    }
  }

  // 4. Success!
  console.log('');
  console.log('┌─────────────────────────────────────────┐');
  console.log('│         ✅ DATABASE CREATED!            │');
  console.log('└─────────────────────────────────────────┘');
  console.log('');
  console.log(`🆔 Project ID: ${project.id}`);
  console.log(`🏠 Host:       ${host}`);
  console.log('');
  console.log('📦 CONNECTION STRING (copy this):');
  console.log('');
  console.log(`   ${connectionUri}`);
  console.log('');
  console.log('💡 Add to your app:');
  console.log(`   DATABASE_URL="${connectionUri}"`);
  console.log('');
  console.log('🔗 Dashboard: https://console.neon.tech/app/projects/' + project.id);
  console.log('');

  // 5. Output for agent parsing
  console.log('---DATABASE_RESULT---');
  console.log(JSON.stringify({
    success: true,
    project_id: project.id,
    project_name: project.name,
    connection_uri: connectionUri,
    host: host,
    region: region,
    dashboard_url: `https://console.neon.tech/app/projects/${project.id}`
  }));
}

// Run
main().catch(error => {
  console.error('');
  console.error(`❌ Unexpected error: ${error.message}`);
  process.exit(1);
});
