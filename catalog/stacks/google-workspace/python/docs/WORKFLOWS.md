# Google Workspace Workflows

This directory contains workflow-focused scripts for common Google Workspace tasks. All workflows integrate with your CRM at `/Users/hoff/Desktop/My Drive/tools/automation/crm/contacts.json`.

## Quick Start

```bash
# Activate virtual environment
cd "/Users/hoff/Desktop/My Drive/tools/api-integrations/google-workspace"
source venv/bin/activate

# Draft an email to Rachel
python workflows/draft_email.py --to "Rachel"

# Send an email from a file
python workflows/send_from_file.py drafts/my_email.md

# Reply to the latest email from a contact
python workflows/reply_to_contact.py --contact "Rachel"

# View and reply to unread emails
python workflows/reply_to_contact.py --unread
```

## Available Workflows

### 1. Draft Email (`draft_email.py`)

Create email drafts to contacts from your CRM. The script will look up contacts by name or email address.

**Interactive Mode** (prompts for all details):
```bash
python workflows/draft_email.py
```

**Quick Draft by Contact Name**:
```bash
# Look up "Rachel" in CRM and create draft
python workflows/draft_email.py --to "Rachel"

# Look up by email
python workflows/draft_email.py --to "rachael.gibson@crowe.com"
```

**Draft with Subject and Body**:
```bash
python workflows/draft_email.py --to "Rachel" \
  --subject "Follow-up from AfroTech" \
  --body "Hi Rachel, following up on our conversation..."
```

**Draft from File**:
```bash
python workflows/draft_email.py --to "Rachel" \
  --file drafts/afrotech_followup.txt
```

**HTML Draft**:
```bash
python workflows/draft_email.py --to "Rachel" \
  --file templates/newsletter.html \
  --html
```

**Features**:
- CRM integration - look up contacts by name
- Multiple contact matches? You'll be prompted to choose
- Creates drafts in Gmail for you to review before sending
- Supports plain text and HTML emails

---

### 2. Send from File (`send_from_file.py`)

Send emails directly from markdown or text files. Perfect for prepared emails, templates, and newsletters.

**File Format with Frontmatter**:

Create a file in `drafts/` with YAML-style metadata at the top:

```markdown
---
to: rachel
subject: Follow-up from AfroTech
cc: zach.ford@crowe.com
---

Hi Rachel,

Hope this email finds you well! Following up from our great conversation at AfroTech...

Looking forward to collaborating on the AI training initiative.

Best,
Brandon
```

**Send Email from File**:
```bash
# Reads metadata from file frontmatter
python workflows/send_from_file.py drafts/rachel_followup.md

# Override recipient
python workflows/send_from_file.py drafts/my_email.txt --to "Rachel"

# Override subject
python workflows/send_from_file.py drafts/my_email.txt \
  --to "Rachel" \
  --subject "Quick Update"

# Add CC/BCC
python workflows/send_from_file.py drafts/my_email.txt \
  --to "Rachel" \
  --cc "zach.ford@crowe.com,brian.jackson@crowe.com"

# Create as draft instead of sending
python workflows/send_from_file.py drafts/my_email.txt \
  --to "Rachel" \
  --draft

# Send HTML email
python workflows/send_from_file.py drafts/newsletter.html \
  --to "team@example.com" \
  --html
```

**Features**:
- YAML frontmatter support for email metadata
- CRM integration for recipient lookup
- CC/BCC support
- Preview before sending
- Create draft or send directly
- Supports plain text and HTML

**Frontmatter Fields**:
- `to:` - Recipient (contact name or email)
- `subject:` - Email subject line
- `cc:` - CC recipients (comma-separated)
- `bcc:` - BCC recipients (comma-separated)

---

### 3. Reply to Contact (`reply_to_contact.py`)

Find and reply to emails from contacts in your CRM. Perfect for quick follow-ups and managing conversations.

**View Emails from a Contact**:
```bash
# Shows recent emails from Rachel and prompts for reply
python workflows/reply_to_contact.py --contact "Rachel"

# Show more emails
python workflows/reply_to_contact.py --contact "Rachel" --limit 20
```

**Reply with Message**:
```bash
python workflows/reply_to_contact.py --contact "Rachel" \
  --message "Thanks for the update! I'll review and get back to you."
```

**Reply from File**:
```bash
python workflows/reply_to_contact.py --contact "Rachel" \
  --file drafts/reply.txt
```

**View All Unread Emails**:
```bash
# Shows all unread emails and lets you select one to reply to
python workflows/reply_to_contact.py --unread
```

**Features**:
- CRM integration - look up contacts by name
- View recent emails from a contact
- Select which email to reply to
- Maintains email threading (In-Reply-To headers)
- View all unread emails across inbox

---

## Directory Structure

```
google-workspace/
├── WORKFLOWS.md          # This file - workflow documentation
├── README.md             # Technical API documentation
├── workflows/            # Workflow scripts
│   ├── draft_email.py
│   ├── send_from_file.py
│   └── reply_to_contact.py
├── drafts/               # Your email drafts (create files here)
├── templates/            # Email templates
├── modules/              # Core API modules
│   ├── auth.py
│   ├── gmail.py
│   ├── sheets.py
│   ├── docs.py
│   └── slides.py
└── examples/             # Example scripts for learning

```

## Email File Examples

### Example 1: Simple Email

**File**: `drafts/quick_update.md`

```markdown
---
to: rachel
subject: Quick Update
---

Hi Rachel,

Just wanted to share a quick update on the project...

Best,
Brandon
```

**Send**:
```bash
python workflows/send_from_file.py drafts/quick_update.md
```

---

### Example 2: Email with CC

**File**: `drafts/team_update.md`

```markdown
---
to: rachel
cc: zach.ford@crowe.com, brian.jackson@crowe.com
subject: AI Training Initiative Update
---

Hi Rachel,

Looping in Zach and Brian as discussed.

Here's the latest on the AI training initiative...

Best,
Brandon
```

**Send**:
```bash
python workflows/send_from_file.py drafts/team_update.md
```

---

### Example 3: Multiple Recipients

**File**: `drafts/broadcast.md`

```markdown
---
to: rachel, wylesha, casey
subject: AfroTech Follow-up
---

Hi everyone,

Great meeting you all at AfroTech! I wanted to follow up...

Best,
Brandon
```

**Send**:
```bash
python workflows/send_from_file.py drafts/broadcast.md
```

---

## Common Workflows

### Workflow 1: Draft an Email to Rachel

```bash
# Option 1: Interactive (prompts for details)
python workflows/draft_email.py --to "Rachel"

# Option 2: From file
python workflows/draft_email.py --to "Rachel" --file drafts/my_message.txt

# Option 3: Quick inline
python workflows/draft_email.py --to "Rachel" \
  --subject "Quick Question" \
  --body "Hi Rachel, quick question about..."
```

### Workflow 2: Send Prepared Email

```bash
# 1. Create your email in drafts/
nano drafts/my_email.md

# 2. Add frontmatter
---
to: rachel
subject: My Subject
---

Your message here...

# 3. Send
python workflows/send_from_file.py drafts/my_email.md
```

### Workflow 3: Reply to Latest Email

```bash
# 1. View recent emails from contact
python workflows/reply_to_contact.py --contact "Rachel"

# 2. Select email and type reply (interactive)
# OR provide reply directly
python workflows/reply_to_contact.py --contact "Rachel" \
  --message "Thanks for the update!"
```

### Workflow 4: Handle Unread Emails

```bash
# View all unread and respond
python workflows/reply_to_contact.py --unread

# Shows numbered list of unread emails
# Select one to reply to
```

---

## Tips & Best Practices

### 1. Contact Names

The workflows understand your CRM. You can use:
- **First name only**: `"Rachel"` → finds Rachael Gibson
- **Full name**: `"Rachael Gibson"`
- **Email address**: `"rachael.gibson@crowe.com"`
- **Partial company**: Searches name, email, and company fields

If multiple contacts match, you'll be prompted to choose.

### 2. Email Files

Store your email drafts in `drafts/` directory:

```bash
# Create draft files
drafts/
├── rachel_followup.md
├── team_update.md
├── partnership_proposal.md
└── weekly_newsletter.html
```

Use `.md` for markdown, `.txt` for plain text, `.html` for HTML emails.

### 3. Templates

Create reusable templates in `templates/` directory:

```bash
templates/
├── followup_template.md
├── partnership_template.md
└── newsletter_template.html
```

Copy templates to `drafts/` and customize before sending.

### 4. Frontmatter Metadata

Always use frontmatter in your email files for cleaner workflows:

```markdown
---
to: contact_name
subject: Email Subject
cc: optional@example.com
bcc: optional@example.com
---

Email body here...
```

This way you can send with just:
```bash
python workflows/send_from_file.py drafts/my_email.md
```

### 5. Review Before Sending

Use `--draft` flag to create drafts instead of sending immediately:

```bash
python workflows/send_from_file.py drafts/important_email.md --draft
```

Then review in Gmail before sending.

---

## Integration with CRM

All workflows integrate with your contact manager at:
```
/Users/hoff/Desktop/My Drive/tools/automation/crm/contacts.json
```

### Managing Contacts

```bash
# Navigate to CRM
cd "/Users/hoff/Desktop/My Drive/tools/automation/crm"

# List all contacts
python contact_manager.py list

# Search for a contact
python contact_manager.py search "rachel"

# Add new contact
python contact_manager.py add "Name" "email@example.com" "Company"

# View stats
python contact_manager.py stats
```

### Linking Emails to Contacts

When you send/reply to emails, the thread IDs are automatically tracked in your CRM's `email_threads` field. This helps maintain conversation history.

---

## Troubleshooting

### "No contact found"

The workflow searches your CRM. If a contact isn't found:
1. Check the contact exists: `python contact_manager.py search "name"`
2. Add the contact if needed: `python contact_manager.py add "Name" "email@example.com" "Company"`
3. Or use the email address directly: `--to "email@example.com"`

### "Contact has no email address"

Some contacts in your CRM may not have email addresses. Update the contact:
```bash
python contact_manager.py update "name" --email "email@example.com"
```

Or specify the email directly in the workflow.

### Authentication Issues

If authentication fails:
```bash
# Re-authenticate
cd "/Users/hoff/Desktop/My Drive/tools/api-integrations/google-workspace"
source venv/bin/activate
rm token.json
python workflows/draft_email.py  # Will trigger re-auth
```

### Scope Issues

If you get a scope error, you may need to delete `token.json` and re-authenticate:
```bash
rm token.json
```

Then run any workflow script to re-authenticate with the correct scopes.

---

## Next Steps

1. **Create Your First Draft**:
   ```bash
   python workflows/draft_email.py --to "Rachel"
   ```

2. **Prepare an Email File**:
   ```bash
   nano drafts/my_first_email.md
   ```
   Add frontmatter and content, then:
   ```bash
   python workflows/send_from_file.py drafts/my_first_email.md
   ```

3. **Reply to Someone**:
   ```bash
   python workflows/reply_to_contact.py --contact "Rachel"
   ```

4. **Check Unread Emails**:
   ```bash
   python workflows/reply_to_contact.py --unread
   ```

---

## Advanced Usage

### Custom Scripts

You can create custom workflow scripts using the modules:

```python
#!/usr/bin/env python3
from modules import GoogleAuth, GmailAPI

auth = GoogleAuth()
gmail = GmailAPI(auth)

# Your custom workflow here
emails = gmail.search_emails('subject:important')
for email in emails:
    print(f"Found: {email['subject']}")
```

### Automation

Combine workflows with cron jobs or other automation tools:

```bash
# Daily unread email check
0 9 * * * cd "/path/to/google-workspace" && ./venv/bin/python workflows/reply_to_contact.py --unread
```

### Integration with Other Tools

The workflows can be integrated with:
- Shell scripts for batch operations
- Other Python scripts in your tools directory
- CI/CD pipelines for automated notifications

---

## Support

For technical API details, see [README.md](README.md)

For CRM management, see `/Users/hoff/Desktop/My Drive/tools/automation/crm/`

For issues or questions, check the Google Workspace API documentation:
https://developers.google.com/gmail/api
