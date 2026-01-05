# Prompts Library

**Location**: `~/.prompt-stack/prompts/`

This directory contains your **prompt templates** - reusable instructions for AI assistants.

---

## What are Prompts?

Prompts are markdown files that contain system instructions for AI models. They help you:
- Get consistent results for common tasks
- Save time with pre-written instructions
- Share useful prompts with your team
- Customize AI behavior for specific tasks

---

## How to Use Prompts

### In Prompt Stack App
1. Open the **Prompts Library** (⌘P or sidebar)
2. Click a prompt to use it
3. The prompt's instructions are sent to the AI
4. Start chatting with the specialized assistant

### File Structure
```markdown
---
name: Code Review
description: Review code for bugs, style, and improvements
icon: 🔍
author: Prompt Stack
---

# Your System Instructions Here

This is where you write the detailed instructions for the AI...
```

---

## Creating Custom Prompts

### Option 1: In the App
1. Click "New Prompt" in the Prompts Library
2. Fill in the name, description, and instructions
3. Save - the file is created here automatically

### Option 2: Create Manually
```bash
cd ~/.prompt-stack/prompts/
nano my-prompt.md
```

**Template**:
```markdown
---
name: My Custom Prompt
description: What this prompt does
icon: ✨
author: Your Name
---

# System Instructions

You are a helpful assistant that...

## Your Role
- Do this
- Do that

## Output Format
- Format results like this
```

---

## Bundled Prompts

These prompts shipped with Prompt Stack:
- **getting-started.md** - Welcome guide for new users
- **explain.md** - Explain code or concepts
- **summarize.md** - Summarize content
- **code-review.md** - Review code for bugs & improvements
- **brainstorm.md** - Generate creative ideas
- **fix-error.md** - Debug and fix errors
- **write-email.md** - Compose professional emails
- **organize-files.md** - Help organize files and folders

**Note**: These are yours to keep and modify! Updates won't overwrite your changes.

---

## Tips

### Good Prompt Structure
```markdown
1. Role definition: "You are a [expert] that..."
2. Task guidelines: "When reviewing code, check for..."
3. Output format: "Always respond with..."
4. Constraints: "Never suggest..."
```

### Make Prompts Reusable
- Use placeholders: "Review the following {language} code..."
- Keep instructions general, not tied to specific examples
- Include output format expectations

### Organize with Prefixes
```
code-review.md
code-explain.md
code-refactor.md

email-professional.md
email-casual.md

writing-blog-post.md
writing-documentation.md
```

---

## Sharing Prompts

Prompts are just markdown files - share them however you like:
- Email the `.md` file
- Copy to a shared folder
- Commit to git
- Share via Slack/Teams

---

## Troubleshooting

**Prompt not showing up?**
- Check the file has `.md` extension
- Check the frontmatter YAML is valid
- Restart Prompt Stack to refresh

**Prompt isn't working as expected?**
- Be specific in instructions
- Include examples of desired output
- Test with different AI models (some prompts work better with different models)

---

## Learn More

- [Prompt Engineering Guide](https://www.promptingguide.ai/)
- [Anthropic Prompt Library](https://docs.anthropic.com/claude/page/prompts)
- Prompt Stack Docs: Run `/help prompts` in the app
