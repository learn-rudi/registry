# Prompt Stack Registry

Community-maintained collection of stacks and prompts for Prompt Stack.

Stacks are executable workflows that combine prompts, tools, and configuration. Prompts are reusable instruction templates.

## Security Notice

**Never include API keys, passwords, or secrets in stack files.** Stacks only DECLARE what secrets are needed; users provide their own values locally. Anyone who submits a stack with hardcoded secrets will be rejected and may face restrictions on future contributions.

## Installation

Search for stacks:

```bash
pstack search youtube
```

Install a stack:

```bash
pstack install youtube-summarizer
```

Run a stack:

```bash
pstack run youtube-summarizer --url "https://youtube.com/watch?v=..."
```

## Repository Structure

```
packages/
├── stacks/
│   └── youtube-summarizer/
│       ├── stack.yaml          # Required: Stack manifest
│       ├── prompt.md           # Prompt instructions
│       └── scripts/            # Optional: Runtime scripts
└── prompts/
    └── code-reviewer/
        └── prompt.md           # Prompt content
```

## Creating a Stack

### 1. Create Directory

```bash
mkdir -p packages/stacks/my-stack
cd packages/stacks/my-stack
```

### 2. Write Manifest

File: `stack.yaml`

**Important: Never include actual secrets or API keys in this file. Only declare what secrets the stack needs.**

```yaml
id: my-stack
kind: stack
name: My Stack
version: 1.0.0
description: Brief description of what this stack does

requires:
  runtimes:
    - node
    - python
  secrets:
    - name: OPENAI_API_KEY
      required: true
      description: "OpenAI API key (get from https://platform.openai.com/api-keys)"

inputs:
  - name: input_file
    type: path
    description: Path to input file
    required: true
  - name: options
    type: string
    description: Processing options
    required: false

outputs:
  - name: result
    type: string
    description: Processing result

entrypoint: process.js
```

**Users who want to run this stack will provide their own API key locally:**

```bash
pstack secrets set OPENAI_API_KEY
# Prompts user to enter their key (not echoed)
# Stored encrypted in ~/.prompt-stack/secrets.json
```

### 2. Write Prompt

File: `prompt.md`

```markdown
# My Stack

You are an expert in processing data.

## Inputs
- Input file: {{input_file}}
- Options: {{options}}

## Task
1. Read and analyze the input file
2. Apply processing logic
3. Output structured results

## Output Format
Return results as JSON with clear structure.
```

### 3. Implement Script

File: `process.js`

```javascript
import { readFile } from 'fs/promises';

async function main() {
  const inputFile = process.env.INPUT_FILE;
  const content = await readFile(inputFile, 'utf-8');

  // Process content
  const result = {
    processed: true,
    length: content.length
  };

  console.log(JSON.stringify(result));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
```

### 4. Submit

Open a pull request with:

1. Your stack directory
2. Description of what it does
3. Example usage and output
4. Any special setup required

## Contributing a Prompt

Prompts are instruction templates for AI models.

### 1. Create Directory

```bash
mkdir -p packages/prompts/my-prompt
cd packages/prompts/my-prompt
```

### 2. Create Prompt File

File: `prompt.md`

```markdown
# Code Reviewer

You are an expert code reviewer specializing in {{language}}.

Your task is to review the provided code and:

1. Identify potential bugs or logic errors
2. Suggest performance improvements
3. Check for security vulnerabilities
4. Ensure code style consistency

Provide detailed feedback with specific line numbers and suggestions.
```

### 3. Submit

Open a pull request with your prompt directory.

## Quality Standards

Contributions should:

- Have a clear, specific purpose
- Include proper YAML/markdown formatting
- Avoid hardcoded secrets (declare in manifest)
- Include examples of inputs and outputs
- Be tested before submission
- Include documentation

## Secret Management

Stacks declare what secrets they require. Users configure them locally:

```bash
pstack secrets set OPENAI_API_KEY
pstack secrets list
```

Secrets are stored encrypted at `~/.prompt-stack/secrets.json` and never committed to git.

## Registry Maintenance

The `index.json` file is auto-generated from the directory structure. Do not edit manually.

Regenerate index:

```bash
npm run generate-index
```

## Contributing

See [CONTRIBUTING.md](../CONTRIBUTING.md) for:

- Code of conduct
- Pull request process
- Commit message conventions
- Review checklist

## License

MIT - Each stack/prompt retains its own license as specified
