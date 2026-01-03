# Google Workspace Workflows - Cheat Sheet

## Activate Environment
```bash
cd "/Users/hoff/Desktop/My Drive/tools/api-integrations/google-workspace"
source venv/bin/activate
```

## Email Workflows

### Draft Email
```bash
# Interactive
python workflows/draft_email.py --to "Rachel"

# With subject & body
python workflows/draft_email.py --to "Rachel" --subject "Update" --body "Message..."

# From file
python workflows/draft_email.py --to "Rachel" --file drafts/message.txt
```

### Send from File
```bash
# Send email (prompts for confirmation)
python workflows/send_from_file.py drafts/my_email.md

# Create draft instead
python workflows/send_from_file.py drafts/my_email.md --draft

# Override recipient
python workflows/send_from_file.py drafts/my_email.md --to "Rachel"

# Send HTML
python workflows/send_from_file.py drafts/newsletter.html --html
```

### Reply to Contact
```bash
# View recent emails and reply
python workflows/reply_to_contact.py --contact "Rachel"

# Quick reply
python workflows/reply_to_contact.py --contact "Rachel" --message "Thanks!"

# Reply from file
python workflows/reply_to_contact.py --contact "Rachel" --file drafts/reply.txt

# Show all unread
python workflows/reply_to_contact.py --unread
```

## Email File Format

```markdown
---
to: rachel
subject: Email Subject
cc: zach.ford@crowe.com
bcc: optional@example.com
---

Email body goes here...

Can use multiple paragraphs.

Best,
Brandon
```

## CRM Commands

```bash
cd "/Users/hoff/Desktop/My Drive/tools/automation/crm"

# List all
python contact_manager.py list

# Search
python contact_manager.py search "rachel"

# Add
python contact_manager.py add "Name" "email@example.com" "Company"

# Update
python contact_manager.py update "email@example.com" --status Active

# Stats
python contact_manager.py stats
```

## Templates

```bash
# List templates
ls templates/

# Copy template
cp templates/followup_template.md drafts/my_email.md

# Edit
nano drafts/my_email.md

# Send
python workflows/send_from_file.py drafts/my_email.md
```

## Contact Lookup

Workflows accept:
- First name: `"Rachel"`
- Full name: `"Rachael Gibson"`
- Email: `"rachael.gibson@crowe.com"`
- Partial: `"gibson"`

## Common Tasks

| Task | Command |
|------|---------|
| Draft to Rachel | `python workflows/draft_email.py --to "Rachel"` |
| Send prepared email | `python workflows/send_from_file.py drafts/file.md` |
| Reply to Rachel | `python workflows/reply_to_contact.py --contact "Rachel"` |
| Check unread | `python workflows/reply_to_contact.py --unread` |
| List contacts | `cd crm && python contact_manager.py list` |

## Flags

| Flag | Purpose | Example |
|------|---------|---------|
| `--to` | Recipient | `--to "Rachel"` |
| `--subject` | Subject line | `--subject "Update"` |
| `--body` | Body text | `--body "Message..."` |
| `--file` | Load from file | `--file drafts/msg.txt` |
| `--html` | Send as HTML | `--html` |
| `--draft` | Create draft | `--draft` |
| `--contact` | Contact name | `--contact "Rachel"` |
| `--message` | Reply message | `--message "Thanks!"` |
| `--unread` | Show unread | `--unread` |
| `--limit` | Limit results | `--limit 20` |
| `--cc` | CC recipients | `--cc "email@example.com"` |
| `--bcc` | BCC recipients | `--bcc "email@example.com"` |

## Troubleshooting

```bash
# Re-authenticate
rm token.json
python workflows/draft_email.py

# Check Python environment
which python

# Activate venv if needed
source venv/bin/activate
```

## Documentation

- [QUICKSTART.md](QUICKSTART.md) - Quick start guide
- [WORKFLOWS.md](WORKFLOWS.md) - Complete workflows
- [README.md](README.md) - Technical docs
- [workflows/README.md](workflows/README.md) - Workflow scripts
- [templates/README.md](templates/README.md) - Templates guide
