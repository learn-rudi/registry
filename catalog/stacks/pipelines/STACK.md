# Pipeline Orchestrator

Chain AI stacks together into powerful workflows.

## What It Does

Combines three stacks into automated pipelines:

| Stack | Provides |
|-------|----------|
| **Claude CLI** | AI research, writing, analysis (via `claude` command) |
| **google-ai-studio** | Image & video generation |
| **google-workspace** | Email, docs, sheets, drive |

## Quick Start

```bash
cd pipelines

# List available pipelines
python run.py --list

# Create content (research → write → image → save to docs)
python run.py content "AI in Healthcare"

# Create newsletter (analyze → write → image → draft email)
python run.py newsletter "Weekly Update" --to "team@example.com"
```

## Available Pipelines

### Content Pipeline

Creates content with research, writing, and visuals.

```bash
python run.py content "Topic Here"
python run.py content "Startup Tips" --type "article"
python run.py content "Product Launch" --type "press release"
```

**Flow:**
1. 🔍 Anthropic researches topic
2. ✍️ Anthropic writes content
3. 🎨 Google AI generates hero image
4. 📄 Saves to Google Docs

### Newsletter Pipeline

Creates email newsletters with optional data analysis.

```bash
# Simple newsletter
python run.py newsletter "Weekly Update" --to "team@example.com"

# With data from Sheets
python run.py newsletter "Sales Report" \
  --spreadsheet "1abc123xyz" \
  --to "sales@example.com"
```

**Flow:**
1. 📊 Pull data from Sheets (optional)
2. 🔍 Anthropic analyzes data/topic
3. ✍️ Anthropic writes newsletter
4. 🎨 Google AI generates header image
5. 📧 Creates Gmail draft

## Build Custom Pipelines

```python
from lib import Pipeline, Step, anthropic, google_ai, google_workspace

# Define steps
async def my_research(topic):
    result = await anthropic.ask_sonnet(f"Research: {topic}")
    return {"research": result["text"]}

async def my_image(topic):
    result = await google_ai.generate_image(f"Banner for {topic}")
    return {"image": result}

async def my_email(to, content):
    result = await google_workspace.create_draft(to, "Update", content)
    return {"draft_id": result["draft_id"]}

# Build pipeline
pipeline = Pipeline(name="my_pipeline", description="Custom workflow")

pipeline.add_step(Step(
    name="research",
    action=my_research,
    inputs={"topic": "AI Trends"},
))

pipeline.add_step(Step(
    name="image",
    action=my_image,
    inputs={"topic": "AI Trends"},
))

pipeline.add_step(Step(
    name="email",
    action=my_email,
    inputs={
        "to": "team@example.com",
        "content": "$research.research",  # Reference previous step
    },
))

# Run it
results = await pipeline.run()
```

## Stack Wrappers

Easy access to each stack:

```python
from lib import claude, google_ai, google_workspace

# Claude CLI - AI Agents
await claude.ask_haiku("Quick question")      # Fast, cheap
await claude.ask_sonnet("Complex analysis")   # Balanced
await claude.ask_opus("Deep reasoning")       # Most capable
await claude.agent("Refactor this code", tools=["Read", "Edit"])

# Google AI - Generation
await google_ai.generate_image("Product photo", model="imagen4-ultra")
await google_ai.generate_video("Demo animation")

# Google Workspace - Automation
await google_workspace.send_email(to, subject, body)
await google_workspace.create_draft(to, subject, body)
await google_workspace.read_sheet(spreadsheet_id, "A1:B10")
await google_workspace.write_sheet(spreadsheet_id, "A1", [[data]])
await google_workspace.create_doc("Title", "Content")
await google_workspace.upload_file("local.pdf", folder_id)
```

## Directory Structure

```
pipelines/
├── run.py              # CLI runner
├── lib/
│   ├── __init__.py
│   ├── orchestrator.py # Pipeline engine
│   └── stacks.py       # Stack wrappers
├── examples/
│   ├── content_pipeline.py
│   └── newsletter_pipeline.py
├── manifest.json
└── STACK.md
```

## Requirements

Requires these to be set up:
- `claude` CLI - installed and authenticated
- `google-ai-studio` - with `GOOGLE_AI_API_KEY`
- `google-workspace` - with OAuth credentials

## Example Use Cases

| Use Case | Pipeline | Description |
|----------|----------|-------------|
| Blog post | `content` | Research, write, add image, save |
| Newsletter | `newsletter` | Analyze data, write, draft email |
| Report | custom | Pull sheets → analyze → create doc |
| Campaign | custom | Write copy → generate visuals → schedule |
| Onboarding | custom | Generate docs → send welcome email |

## License

MIT
