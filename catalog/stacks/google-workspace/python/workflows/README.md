# Workflows Directory

This directory contains workflow scripts for common Google Workspace tasks.

## Available Workflows

| Script | Purpose | Quick Example |
|--------|---------|---------------|
| [draft_email.py](draft_email.py) | Create email drafts to CRM contacts | `python workflows/draft_email.py --to "Rachel"` |
| [send_from_file.py](send_from_file.py) | Send emails from markdown/text files | `python workflows/send_from_file.py drafts/my_email.md` |
| [reply_to_contact.py](reply_to_contact.py) | Reply to emails from contacts | `python workflows/reply_to_contact.py --contact "Rachel"` |

## Quick Start

### Draft an Email

```bash
# Interactive mode
python workflows/draft_email.py --to "Rachel"

# From file
python workflows/draft_email.py --to "Rachel" --file drafts/message.txt
```

### Send from File

```bash
# Create email file with frontmatter
cat > drafts/my_email.md <<EOF
---
to: rachel
subject: Quick Update
---

Hi Rachel,

Just wanted to share a quick update...

Best,
Brandon
EOF

# Send it
python workflows/send_from_file.py drafts/my_email.md
```

### Reply to Contact

```bash
# View recent emails and reply
python workflows/reply_to_contact.py --contact "Rachel"

# Quick reply
python workflows/reply_to_contact.py --contact "Rachel" \
  --message "Thanks for the update!"
```

## CRM Integration

All workflows integrate with your contact manager:
```
/Users/hoff/Desktop/My Drive/tools/automation/crm/contacts.json
```

You can reference contacts by:
- First name: `"Rachel"`
- Full name: `"Rachael Gibson"`
- Email: `"rachael.gibson@crowe.com"`

## Features

- **CRM Lookup**: Automatically finds contacts by name or email
- **Smart Matching**: Handles partial names and multiple matches
- **Email Threading**: Maintains conversation threads in replies
- **Draft Mode**: Preview before sending
- **File Support**: Send from markdown, text, or HTML files
- **Frontmatter**: YAML metadata in email files

## Documentation

For detailed usage and examples, see:
- [WORKFLOWS.md](../WORKFLOWS.md) - Complete workflow guide
- [README.md](../README.md) - Technical API documentation

## Common Tasks

### Task 1: Send a Prepared Email to Rachel

```bash
# 1. Create draft file
nano drafts/rachel_update.md

# 2. Add content with frontmatter
---
to: rachel
subject: Project Update
---

Hi Rachel, ...

# 3. Send
python workflows/send_from_file.py drafts/rachel_update.md
```

### Task 2: Reply to Latest Email from Zach

```bash
python workflows/reply_to_contact.py --contact "zach" \
  --message "Thanks Zach, I'll review the contract and get back to you."
```

### Task 3: Draft Team Email

```bash
python workflows/draft_email.py \
  --to "rachel" \
  --subject "Team Meeting Notes" \
  --file drafts/meeting_notes.md
```

### Task 4: Check and Reply to Unread

```bash
python workflows/reply_to_contact.py --unread
```

## Tips

1. **Use Templates**: Copy from `../templates/` for common email types
2. **CRM First**: Add contacts to CRM before emailing them
3. **Draft Mode**: Use `--draft` to review before sending
4. **Frontmatter**: Add metadata to files for cleaner commands

## Example Email File

```markdown
---
to: rachel
subject: Following Up from AfroTech
cc: zach.ford@crowe.com
---

Hi Rachel,

Hope you're doing well! Following up from our conversation at AfroTech...

Looking forward to collaborating!

Best,
Brandon
```

Send with:
```bash
python workflows/send_from_file.py drafts/rachel_followup.md
```

## Troubleshooting

**Contact Not Found**:
```bash
# Add to CRM first
cd "/Users/hoff/Desktop/My Drive/tools/automation/crm"
python contact_manager.py add "Name" "email@example.com" "Company"
```

**Authentication Error**:
```bash
# Re-authenticate
rm ../token.json
python workflows/draft_email.py  # Triggers auth flow
```

## Next Steps

1. Read [WORKFLOWS.md](../WORKFLOWS.md) for detailed documentation
2. Explore [templates/](../templates/) for email templates
3. Check [examples/](../examples/) for API usage examples
