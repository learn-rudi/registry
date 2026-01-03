# Google Workspace Tools

Workflow-focused tools for Gmail, Sheets, Docs, Slides, Drive, and Calendar.

## Features

- **Gmail**: Draft, send, reply to emails from markdown files
- **Sheets**: Read/write spreadsheet data
- **Docs**: Create and edit documents
- **Drive**: Upload and manage files
- **Calendar**: Create and list events
- **Slides**: Create presentations
- **Templates**: Reusable email templates

## Quick Start

```bash
# Setup
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt

# First run triggers OAuth flow
python workflows/draft_email.py --to "Contact Name"
```

## Common Tasks

### Draft Email
```bash
python workflows/draft_email.py --to "Rachel"
python workflows/draft_email.py --to "Rachel" --subject "Update" --body "Message..."
```

### Send from File
```bash
python workflows/send_from_file.py drafts/email.md
python workflows/send_from_file.py drafts/email.md --draft  # Create draft instead
```

### Reply to Contact
```bash
python workflows/reply_to_contact.py --contact "Rachel"
python workflows/reply_to_contact.py --unread  # Show all unread
```

## File Format for Emails

```markdown
---
to: contact_name
subject: Subject Here
cc: optional@example.com
---

Email body here...
```

## API Modules

```python
from modules import GoogleAuth, GmailAPI, SheetsAPI, DocsAPI, DriveAPI

# Authenticate
auth = GoogleAuth()

# Gmail
gmail = GmailAPI(auth)
emails = gmail.search_emails('subject:important')
gmail.send_email('to@example.com', 'Subject', 'Body')

# Sheets
sheets = SheetsAPI(auth)
data = sheets.get_values(spreadsheet_id, 'Sheet1!A1:B10')
sheets.update_values(spreadsheet_id, 'Sheet1!A1', [['value1', 'value2']])

# Drive
drive = DriveAPI(auth)
drive.upload_file('local.pdf', 'folder_id')

# Docs
docs = DocsAPI(auth)
docs.create_document('New Doc', 'Content here')
```

## Directory Structure

```
google-workspace/
├── workflows/         # Ready-to-use scripts
│   ├── draft_email.py
│   ├── send_from_file.py
│   └── reply_to_contact.py
├── modules/           # API wrappers
│   ├── gmail.py
│   ├── sheets.py
│   ├── docs.py
│   ├── drive.py
│   ├── calendar.py
│   └── slides.py
├── templates/         # Email templates
├── drafts/            # Your email drafts
├── examples/          # Example scripts
└── config/            # Configuration
```

## Setup Google Cloud

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create project, enable Gmail/Sheets/Drive/etc APIs
3. Create OAuth 2.0 credentials (Desktop app)
4. Download `credentials.json` to `config/`
5. Run any script to trigger OAuth flow

## Templates

```bash
# Copy and customize
cp templates/followup_template.md drafts/my_followup.md

# Edit
nano drafts/my_followup.md

# Send
python workflows/send_from_file.py drafts/my_followup.md
```

**Available templates:**
- `followup_template.md` - Follow-up emails
- `introduction_template.md` - Introductions
- `partnership_template.md` - Partnership proposals
- `quick_update_template.md` - Status updates

## License

MIT
