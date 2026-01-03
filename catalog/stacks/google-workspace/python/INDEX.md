# Directory Index

Complete index of all files and directories in Google Workspace tools.

## 🎯 Start Here

1. **First time?** → [README.md](README.md)
2. **Need command fast?** → [QUICKSTART.md](QUICKSTART.md)
3. **Want to learn?** → [docs/WORKFLOWS.md](docs/WORKFLOWS.md)

---

## 📂 Directory Map

### 📧 [workflows/](workflows/) - Main Workflow Scripts
**Purpose**: Ready-to-use scripts for common email tasks

| Script | Purpose |
|--------|---------|
| [draft_email.py](workflows/draft_email.py) | Draft emails to CRM contacts |
| [send_from_file.py](workflows/send_from_file.py) | Send emails from markdown/text files |
| [reply_to_contact.py](workflows/reply_to_contact.py) | Reply to emails from contacts |
| [README.md](workflows/README.md) | Workflow documentation |

**Use when**: You want to draft, send, or reply to emails

---

### 📝 [drafts/](drafts/) - Your Email Drafts
**Purpose**: Store your email files here before sending

| File | Purpose |
|------|---------|
| [example_email.md](drafts/example_email.md) | Example email file format |

**Use when**: Creating emails to send via workflows

**Example**:
```bash
# Create draft
nano drafts/rachel_followup.md

# Send
python workflows/send_from_file.py drafts/rachel_followup.md
```

---

### 📋 [templates/](templates/) - Email Templates
**Purpose**: Reusable email templates to copy and customize

| Template | Purpose |
|----------|---------|
| [followup_template.md](templates/followup_template.md) | Follow-up emails |
| [introduction_template.md](templates/introduction_template.md) | Event introductions |
| [partnership_template.md](templates/partnership_template.md) | Partnership proposals |
| [quick_update_template.md](templates/quick_update_template.md) | Status updates |
| [README.md](templates/README.md) | Template usage guide |

**Use when**: Starting a new email and want a template

**Example**:
```bash
cp templates/followup_template.md drafts/my_email.md
```

---

### 📚 [docs/](docs/) - Detailed Documentation
**Purpose**: Comprehensive guides and references

| Document | Purpose | When to Read |
|----------|---------|--------------|
| [WORKFLOWS.md](docs/WORKFLOWS.md) | Complete workflow guide | Learning workflows |
| [CHEATSHEET.md](docs/CHEATSHEET.md) | Command cheat sheet | Quick lookup |
| [SETUP-GUIDE.md](docs/SETUP-GUIDE.md) | Initial setup guide | First time setup |
| [README.md](docs/README.md) | Documentation index | Finding docs |

**Use when**: Need detailed explanations or reference

---

### 💡 [examples/](examples/) - Example Scripts
**Purpose**: Code examples demonstrating API usage

| Example | Purpose |
|---------|---------|
| [email_manager_example.py](examples/email_manager_example.py) | Interactive email manager |
| [send_email_example.py](examples/send_email_example.py) | Sending emails example |
| [sheets_example.py](examples/sheets_example.py) | Google Sheets operations |
| [docs_example.py](examples/docs_example.py) | Google Docs operations |
| [drive_example.py](examples/drive_example.py) | Google Drive operations |
| [slides_example.py](examples/slides_example.py) | Google Slides operations |
| [combined_example.py](examples/combined_example.py) | Using multiple APIs |

**Use when**: Learning API or building custom scripts

---

### 🔧 [modules/](modules/) - Core API Modules
**Purpose**: Low-level API implementation (don't modify)

| Module | Purpose |
|--------|---------|
| [auth.py](modules/auth.py) | Google OAuth authentication |
| [gmail.py](modules/gmail.py) | Gmail API wrapper |
| [sheets.py](modules/sheets.py) | Google Sheets API |
| [docs.py](modules/docs.py) | Google Docs API |
| [drive.py](modules/drive.py) | Google Drive API |
| [slides.py](modules/slides.py) | Google Slides API |

**Use when**: Building custom scripts with the APIs

---

### 📦 [archive/](archive/) - Old Scripts
**Purpose**: Legacy code kept for reference

| Category | Files |
|----------|-------|
| Old email scripts | send_email.py, test_send.py, search_*.py |
| Legacy tools | TikTok sheets scripts, organize_files.py |

**Use when**: Reference only (use new workflows instead)

---

### ⚙️ [config/](config/) - Configuration
**Purpose**: App configuration files

| File | Purpose |
|------|---------|
| [config.py](config/config.py) | Python configuration |
| [.env.example](config/.env.example) | Environment template |

**Use when**: Configuring the application

---

## 📄 Root Files

### Documentation
- **[README.md](README.md)** - Main documentation (START HERE)
- **[QUICKSTART.md](QUICKSTART.md)** - Quick reference
- **[INDEX.md](INDEX.md)** - This file

### Configuration
- **[credentials.json](credentials.json)** - Google OAuth credentials
- **[token.json](token.json)** - Authentication token (auto-generated)
- **[requirements.txt](requirements.txt)** - Python dependencies
- **[.gitignore](.gitignore)** - Git ignore rules

### Directories
- **venv/** - Python virtual environment

---

## 🗺️ Navigation Guide

### By Task

| I want to... | Go to... |
|--------------|----------|
| Draft an email | [workflows/draft_email.py](workflows/draft_email.py) |
| Send from file | [workflows/send_from_file.py](workflows/send_from_file.py) |
| Reply to email | [workflows/reply_to_contact.py](workflows/reply_to_contact.py) |
| Use template | [templates/](templates/) |
| Learn workflows | [docs/WORKFLOWS.md](docs/WORKFLOWS.md) |
| Quick command | [QUICKSTART.md](QUICKSTART.md) or [docs/CHEATSHEET.md](docs/CHEATSHEET.md) |
| See examples | [examples/](examples/) |
| Build custom script | [modules/](modules/) + [examples/](examples/) |

### By Experience Level

**Beginner** (First time):
1. [README.md](README.md) - Overview
2. [QUICKSTART.md](QUICKSTART.md) - Quick commands
3. [workflows/draft_email.py](workflows/draft_email.py) - Try first workflow

**Intermediate** (Learning):
1. [docs/WORKFLOWS.md](docs/WORKFLOWS.md) - Complete guide
2. [templates/](templates/) - Email templates
3. [examples/](examples/) - Code examples

**Advanced** (Building):
1. [modules/](modules/) - API modules
2. [examples/combined_example.py](examples/combined_example.py) - Complex examples
3. [docs/CHEATSHEET.md](docs/CHEATSHEET.md) - Quick reference

---

## 🔍 File Organization

```
google-workspace/
│
├── 📖 Documentation (Read First)
│   ├── README.md           Main entry point
│   ├── QUICKSTART.md       Quick commands
│   ├── INDEX.md           This file
│   └── docs/              Detailed guides
│
├── ⚡ Main Tools (Use These)
│   ├── workflows/         Email workflow scripts
│   ├── drafts/           Your email files
│   └── templates/        Email templates
│
├── 🛠️ Development
│   ├── modules/          Core API code
│   ├── examples/         Example scripts
│   └── config/           Configuration
│
└── 📦 Other
    ├── archive/          Old scripts
    ├── venv/            Python environment
    └── *.json           Auth & config files
```

---

## 💡 Quick Tips

### Finding What You Need

**Question**: How do I draft an email to Rachel?
**Answer**: [workflows/draft_email.py](workflows/draft_email.py) or [QUICKSTART.md](QUICKSTART.md)

**Question**: Where are email templates?
**Answer**: [templates/](templates/)

**Question**: How does CRM integration work?
**Answer**: [docs/WORKFLOWS.md](docs/WORKFLOWS.md) (CRM Integration section)

**Question**: What are all the commands?
**Answer**: [docs/CHEATSHEET.md](docs/CHEATSHEET.md)

**Question**: How to build custom script?
**Answer**: [examples/](examples/) then [modules/](modules/)

---

## 📊 File Count Summary

| Directory | Files | Purpose |
|-----------|-------|---------|
| workflows/ | 4 | Main email workflows |
| templates/ | 5 | Email templates |
| drafts/ | 1 | User email drafts |
| docs/ | 4 | Documentation |
| examples/ | 7 | Code examples |
| modules/ | 7 | API implementations |
| archive/ | 11 | Old scripts |
| config/ | 2 | Configuration |
| Root | 8 | Main files |

**Total**: 48 files across 9 directories

---

## 🚀 Getting Started Checklist

- [ ] Read [README.md](README.md)
- [ ] Run `source venv/bin/activate`
- [ ] Try `python workflows/draft_email.py --to "Rachel"`
- [ ] Read [QUICKSTART.md](QUICKSTART.md)
- [ ] Explore [templates/](templates/)
- [ ] Review [docs/WORKFLOWS.md](docs/WORKFLOWS.md)
- [ ] Check [examples/](examples/) for code samples

---

**Updated**: 2025-11-14
