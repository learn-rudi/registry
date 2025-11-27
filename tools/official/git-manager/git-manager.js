#!/usr/bin/env node
/**
 * PROMPT STACK - GIT MANAGER TOOL
 *
 * Initialize repos, commit changes, and push to GitHub.
 * Supports creating new GitHub repos automatically.
 *
 * Actions:
 *   init       - Initialize a new git repository
 *   status     - Show git status
 *   commit     - Stage all changes and commit
 *   create-repo - Create a new GitHub repository
 *   push       - Push to GitHub (creates repo if needed)
 *
 * Usage:
 *   node git-manager.js --action=init --project_path=/path/to/project
 *   node git-manager.js --action=commit --project_path=/path --message="Initial commit"
 *   node git-manager.js --action=push --project_path=/path --repo_name=my-app
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// =============================================================================
// CONFIG
// =============================================================================

const GITHUB_API = 'https://api.github.com';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

// =============================================================================
// ARGUMENT PARSING
// =============================================================================

const args = process.argv.slice(2);
const getArg = (name) => {
  const arg = args.find(a => a.startsWith(`--${name}=`));
  return arg ? arg.split('=').slice(1).join('=') : null;
};
const hasFlag = (name) => args.includes(`--${name}`);

const action = getArg('action');
const projectPath = getArg('project_path');
const commitMessage = getArg('message');
const repoName = getArg('repo_name');
const isPrivate = hasFlag('private');

// =============================================================================
// VALIDATION
// =============================================================================

const VALID_ACTIONS = ['init', 'status', 'commit', 'create-repo', 'push'];

if (!action || !VALID_ACTIONS.includes(action)) {
  console.error('');
  console.error(`❌ Invalid or missing action: ${action}`);
  console.error(`   Valid actions: ${VALID_ACTIONS.join(', ')}`);
  process.exit(1);
}

if (!projectPath) {
  console.error('');
  console.error('❌ Project path is required.');
  console.error('   Usage: --project_path=/path/to/project');
  process.exit(1);
}

const fullPath = path.resolve(projectPath);
if (!fs.existsSync(fullPath)) {
  console.error(`❌ Project path not found: ${fullPath}`);
  process.exit(1);
}

// Actions that need GitHub token
if (['create-repo', 'push'].includes(action) && !GITHUB_TOKEN) {
  console.error('');
  console.error('❌ GITHUB_TOKEN not found.');
  console.error('');
  console.error('Add your token in:');
  console.error('  Prompt Stack → Settings → Cloud & Secrets → GitHub → Connect');
  console.error('');
  console.error('Get your token: https://github.com/settings/tokens');
  console.error('Required scopes: repo, workflow');
  process.exit(1);
}

// =============================================================================
// HELPERS
// =============================================================================

function git(command, options = {}) {
  try {
    const result = execSync(`git ${command}`, {
      cwd: fullPath,
      encoding: 'utf-8',
      stdio: options.silent ? 'pipe' : 'inherit',
      ...options
    });
    return result?.trim() || '';
  } catch (error) {
    if (options.ignoreError) return '';
    throw error;
  }
}

function isGitRepo() {
  try {
    execSync('git rev-parse --git-dir', { cwd: fullPath, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function hasRemote() {
  try {
    const remote = execSync('git remote get-url origin', { cwd: fullPath, encoding: 'utf-8', stdio: 'pipe' });
    return remote.trim().length > 0;
  } catch {
    return false;
  }
}

function getCurrentBranch() {
  try {
    return execSync('git branch --show-current', { cwd: fullPath, encoding: 'utf-8', stdio: 'pipe' }).trim() || 'main';
  } catch {
    return 'main';
  }
}

async function getGitHubUsername() {
  const response = await fetch(`${GITHUB_API}/user`, {
    headers: {
      'Authorization': `Bearer ${GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github.v3+json'
    }
  });
  if (!response.ok) throw new Error('Failed to get GitHub username');
  const data = await response.json();
  return data.login;
}

async function createGitHubRepo(name, isPrivate) {
  const response = await fetch(`${GITHUB_API}/user/repos`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name: name,
      private: isPrivate,
      auto_init: false
    })
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    if (response.status === 422 && error.errors?.[0]?.message?.includes('already exists')) {
      // Repo exists, that's fine
      const username = await getGitHubUsername();
      return { html_url: `https://github.com/${username}/${name}`, clone_url: `https://github.com/${username}/${name}.git`, existed: true };
    }
    throw new Error(error.message || `GitHub API error: ${response.status}`);
  }

  const data = await response.json();
  return { html_url: data.html_url, clone_url: data.clone_url, existed: false };
}

// =============================================================================
// ACTIONS
// =============================================================================

async function actionInit() {
  console.log('');
  console.log('┌─────────────────────────────────────────┐');
  console.log('│       PROMPT STACK → GIT INIT           │');
  console.log('└─────────────────────────────────────────┘');
  console.log('');

  if (isGitRepo()) {
    console.log('ℹ️  Already a git repository.');
    console.log(`   Path: ${fullPath}`);
    return;
  }

  console.log(`📁 Initializing git in: ${fullPath}`);
  git('init');
  git('branch -M main', { ignoreError: true });

  // Create .gitignore if it doesn't exist
  const gitignorePath = path.join(fullPath, '.gitignore');
  if (!fs.existsSync(gitignorePath)) {
    const defaultGitignore = `# Dependencies
node_modules/
.venv/
__pycache__/

# Build outputs
dist/
build/
.next/

# Environment
.env
.env.local
.env.*.local

# IDE
.idea/
.vscode/
*.swp

# OS
.DS_Store
Thumbs.db
`;
    fs.writeFileSync(gitignorePath, defaultGitignore);
    console.log('📝 Created .gitignore');
  }

  console.log('');
  console.log('✅ Git repository initialized!');
  console.log('');
  console.log('Next steps:');
  console.log('  1. git add .');
  console.log('  2. git commit -m "Initial commit"');
  console.log('  3. Use "push" action to push to GitHub');
}

async function actionStatus() {
  console.log('');
  console.log('┌─────────────────────────────────────────┐');
  console.log('│       PROMPT STACK → GIT STATUS         │');
  console.log('└─────────────────────────────────────────┘');
  console.log('');

  if (!isGitRepo()) {
    console.log('❌ Not a git repository.');
    console.log('   Use --action=init first.');
    return;
  }

  console.log(`📁 Repository: ${fullPath}`);
  console.log(`🌿 Branch: ${getCurrentBranch()}`);
  console.log(`🔗 Remote: ${hasRemote() ? 'configured' : 'not configured'}`);
  console.log('');
  git('status');
}

async function actionCommit() {
  console.log('');
  console.log('┌─────────────────────────────────────────┐');
  console.log('│       PROMPT STACK → GIT COMMIT         │');
  console.log('└─────────────────────────────────────────┘');
  console.log('');

  if (!isGitRepo()) {
    console.log('❌ Not a git repository. Use --action=init first.');
    process.exit(1);
  }

  const message = commitMessage || 'Update from Prompt Stack';

  console.log(`📁 Project: ${path.basename(fullPath)}`);
  console.log(`💬 Message: ${message}`);
  console.log('');

  // Stage all changes
  console.log('📦 Staging changes...');
  git('add -A');

  // Check if there's anything to commit
  const status = git('status --porcelain', { silent: true });
  if (!status) {
    console.log('');
    console.log('ℹ️  Nothing to commit. Working tree clean.');
    return;
  }

  // Commit
  console.log('');
  git(`commit -m "${message.replace(/"/g, '\\"')}"`);

  // Get commit SHA
  const sha = git('rev-parse --short HEAD', { silent: true });

  console.log('');
  console.log('✅ Changes committed!');
  console.log(`   SHA: ${sha}`);

  console.log('');
  console.log('---GIT_RESULT---');
  console.log(JSON.stringify({ success: true, action: 'commit', commit_sha: sha, message }));
}

async function actionCreateRepo() {
  console.log('');
  console.log('┌─────────────────────────────────────────┐');
  console.log('│     PROMPT STACK → CREATE GITHUB REPO   │');
  console.log('└─────────────────────────────────────────┘');
  console.log('');

  const name = repoName || path.basename(fullPath);
  const visibility = isPrivate ? 'Private' : 'Public';

  console.log(`📦 Repository: ${name}`);
  console.log(`🔒 Visibility: ${visibility}`);
  console.log('');

  console.log('⏳ Creating repository on GitHub...');

  try {
    const repo = await createGitHubRepo(name, isPrivate);

    if (repo.existed) {
      console.log('');
      console.log('ℹ️  Repository already exists!');
    } else {
      console.log('');
      console.log('✅ Repository created!');
    }

    console.log(`🔗 URL: ${repo.html_url}`);

    console.log('');
    console.log('---GIT_RESULT---');
    console.log(JSON.stringify({ success: true, action: 'create-repo', repo_url: repo.html_url, repo_name: name }));
  } catch (error) {
    console.error(`❌ Failed to create repository: ${error.message}`);
    process.exit(1);
  }
}

async function actionPush() {
  console.log('');
  console.log('┌─────────────────────────────────────────┐');
  console.log('│       PROMPT STACK → GIT PUSH           │');
  console.log('└─────────────────────────────────────────┘');
  console.log('');

  if (!isGitRepo()) {
    console.log('⏳ Initializing git repository first...');
    git('init');
    git('branch -M main', { ignoreError: true });
  }

  const name = repoName || path.basename(fullPath);
  const branch = getCurrentBranch();

  console.log(`📁 Project: ${name}`);
  console.log(`🌿 Branch: ${branch}`);
  console.log('');

  // Check if we have a remote
  if (!hasRemote()) {
    console.log('⏳ No remote found. Creating GitHub repository...');

    try {
      const username = await getGitHubUsername();
      const repo = await createGitHubRepo(name, isPrivate);

      // Add remote
      const remoteUrl = `https://${GITHUB_TOKEN}@github.com/${username}/${name}.git`;
      git(`remote add origin ${remoteUrl}`);

      console.log(`✅ Remote added: ${repo.html_url}`);
      console.log('');
    } catch (error) {
      console.error(`❌ Failed to create repository: ${error.message}`);
      process.exit(1);
    }
  }

  // Make sure we have at least one commit
  const hasCommits = git('rev-parse HEAD', { silent: true, ignoreError: true });
  if (!hasCommits) {
    console.log('📦 Creating initial commit...');
    git('add -A');
    git('commit -m "Initial commit from Prompt Stack"', { ignoreError: true });
  }

  // Push
  console.log('⏳ Pushing to GitHub...');
  try {
    git(`push -u origin ${branch}`);
  } catch (error) {
    // Try force push if branch doesn't exist yet
    git(`push -u origin ${branch} --force`, { ignoreError: true });
  }

  // Get the repo URL (without token)
  const remoteUrl = git('remote get-url origin', { silent: true });
  const cleanUrl = remoteUrl.replace(/https:\/\/[^@]+@/, 'https://');

  console.log('');
  console.log('┌─────────────────────────────────────────┐');
  console.log('│           ✅ PUSHED TO GITHUB!          │');
  console.log('└─────────────────────────────────────────┘');
  console.log('');
  console.log(`🔗 Repository: ${cleanUrl}`);
  console.log(`🌿 Branch: ${branch}`);
  console.log('');

  console.log('---GIT_RESULT---');
  console.log(JSON.stringify({ success: true, action: 'push', repo_url: cleanUrl, branch }));
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  switch (action) {
    case 'init':
      await actionInit();
      break;
    case 'status':
      await actionStatus();
      break;
    case 'commit':
      await actionCommit();
      break;
    case 'create-repo':
      await actionCreateRepo();
      break;
    case 'push':
      await actionPush();
      break;
  }
}

main().catch(error => {
  console.error('');
  console.error(`❌ Unexpected error: ${error.message}`);
  process.exit(1);
});
