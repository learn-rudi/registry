# Quick Start Guide

One-page reference for the most common workflows.

## Setup

```bash
cd "/Users/hoff/Desktop/My Drive/tools/api-integrations/google-workspace"
source venv/bin/activate
```

## Common Commands

### Draft Email to Rachel
```bash
python workflows/draft_email.py --to "Rachel"
```

### Send Email from File
```bash
# 1. Create file
cat > drafts/my_email.md <<EOF
---
to: rachel
subject: Quick Update
---

Hi Rachel,

Your message here...

Best,
Brandon
EOF

# 2. Send
python workflows/send_from_file.py drafts/my_email.md
```

### Reply to Rachel's Latest Email
```bash
python workflows/reply_to_contact.py --contact "Rachel"
```

### Check Unread Emails
```bash
python workflows/reply_to_contact.py --unread
```

## File Format

Email files use YAML frontmatter:

```markdown
---
to: contact_name
subject: Email Subject
cc: optional@example.com
---

Email body here...
```

## CRM Contacts

```bash
cd "/Users/hoff/Desktop/My Drive/tools/automation/crm"

# List contacts
python contact_manager.py list

# Search
python contact_manager.py search "rachel"

# Add contact
python contact_manager.py add "Name" "email@example.com" "Company"
```

## Most Used Workflows

| Task | Command |
|------|---------|
| Draft to contact | `python workflows/draft_email.py --to "Name"` |
| Send from file | `python workflows/send_from_file.py drafts/file.md` |
| Reply to contact | `python workflows/reply_to_contact.py --contact "Name"` |
| Check unread | `python workflows/reply_to_contact.py --unread` |

## Templates

Copy and customize:
```bash
cp templates/followup_template.md drafts/my_email.md
nano drafts/my_email.md
python workflows/send_from_file.py drafts/my_email.md
```

## Full Documentation

- [README.md](README.md) - Main documentation with directory structure
- [docs/WORKFLOWS.md](docs/WORKFLOWS.md) - Complete workflow guide
- [docs/CHEATSHEET.md](docs/CHEATSHEET.md) - Command cheat sheet
- [workflows/README.md](workflows/README.md) - Workflow scripts
- [templates/README.md](templates/README.md) - Email templates
