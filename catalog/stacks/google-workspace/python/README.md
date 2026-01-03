# Google Workspace Tools

Workflow-focused tools for Gmail, Google Sheets, Docs, Slides, and Drive with CRM integration.

## 🚀 Quick Start

```bash
# Activate environment
cd "/Users/hoff/Desktop/My Drive/tools/api-integrations/google-workspace"
source venv/bin/activate

# Draft email to a contact
python workflows/draft_email.py --to "Rachel"

# Send email from file
python workflows/send_from_file.py drafts/my_email.md

# Reply to latest email
python workflows/reply_to_contact.py --contact "Rachel"
```

**Need help?** → See [QUICKSTART.md](QUICKSTART.md)

---

## 📁 Directory Structure

```
google-workspace/
│
├── 📧 workflows/          ← START HERE for email tasks
│   ├── draft_email.py           Draft emails to contacts
│   ├── send_from_file.py        Send from markdown/text files
│   └── reply_to_contact.py      Reply to contact emails
│
├── 📝 drafts/             ← Your email drafts go here
│   └── example_email.md         Example email file
│
├── 📋 templates/          ← Copy & customize email templates
│   ├── followup_template.md
│   ├── introduction_template.md
│   ├── partnership_template.md
│   └── quick_update_template.md
│
├── 🔧 modules/            ← Core API modules (don't touch)
│   ├── auth.py
│   ├── gmail.py
│   ├── sheets.py
│   └── ...
│
├── 💡 examples/           ← Example scripts for learning
│
├── 📚 docs/               ← Detailed documentation
│   ├── WORKFLOWS.md             Complete workflow guide
│   ├── CHEATSHEET.md            Command reference
│   └── SETUP-GUIDE.md           Initial setup instructions
│
├── 📦 archive/            ← Old scripts & tests
│
└── ⚙️  config/             ← Configuration files
    ├── config.py
    └── .env.example
```

---

## 💬 Common Tasks

### Task 1: Draft an Email to Rachel
```bash
python workflows/draft_email.py --to "Rachel"
```
Looks up "Rachel" in your CRM and creates a draft in Gmail.

---

### Task 2: Send an Email from a File

**Create file** `drafts/my_email.md`:
```markdown
---
to: rachel
subject: Quick Update
---

Hi Rachel,

Your message here...

Best,
Brandon
```

**Send it**:
```bash
python workflows/send_from_file.py drafts/my_email.md
```

---

### Task 3: Reply to a Contact
```bash
python workflows/reply_to_contact.py --contact "Rachel"
```
Shows recent emails from Rachel, lets you select one and reply.

---

### Task 4: Check Unread Emails
```bash
python workflows/reply_to_contact.py --unread
```

---

## 📖 Documentation

| Document | Purpose | When to Use |
|----------|---------|-------------|
| **[QUICKSTART.md](QUICKSTART.md)** | Quick reference | Need a command fast |
| **[docs/WORKFLOWS.md](docs/WORKFLOWS.md)** | Complete guide with examples | Learning workflows |
| **[docs/CHEATSHEET.md](docs/CHEATSHEET.md)** | Command cheat sheet | Quick lookup |
| **[docs/SETUP-GUIDE.md](docs/SETUP-GUIDE.md)** | Initial setup | First time setup |
| **[workflows/README.md](workflows/README.md)** | Workflow scripts | Script details |
| **[templates/README.md](templates/README.md)** | Template guide | Using templates |

---

## 🔗 CRM Integration

All workflows integrate with your contact manager:
```
/Users/hoff/Desktop/My Drive/tools/automation/crm/contacts.json
```

**Manage contacts**:
```bash
cd "/Users/hoff/Desktop/My Drive/tools/automation/crm"

# List all contacts
python contact_manager.py list

# Search for a contact
python contact_manager.py search "rachel"

# Add new contact
python contact_manager.py add "Name" "email@example.com" "Company"
```

---

## ⚡ Workflow Scripts

### 1. Draft Email (`workflows/draft_email.py`)
Create email drafts to contacts from your CRM.

```bash
# Interactive mode
python workflows/draft_email.py --to "Rachel"

# With content
python workflows/draft_email.py --to "Rachel" \
  --subject "Update" \
  --body "Message..."

# From file
python workflows/draft_email.py --to "Rachel" --file drafts/msg.txt
```

---

### 2. Send from File (`workflows/send_from_file.py`)
Send emails from markdown or text files with YAML frontmatter.

```bash
# Send (prompts for confirmation)
python workflows/send_from_file.py drafts/email.md

# Create draft instead
python workflows/send_from_file.py drafts/email.md --draft

# Send HTML
python workflows/send_from_file.py drafts/newsletter.html --html
```

**File Format**:
```markdown
---
to: contact_name
subject: Subject Here
cc: optional@example.com
---

Email body here...
```

---

### 3. Reply to Contact (`workflows/reply_to_contact.py`)
Find and reply to emails from contacts.

```bash
# View emails and reply
python workflows/reply_to_contact.py --contact "Rachel"

# Quick reply
python workflows/reply_to_contact.py --contact "Rachel" \
  --message "Thanks!"

# Reply from file
python workflows/reply_to_contact.py --contact "Rachel" \
  --file drafts/reply.txt

# Show all unread
python workflows/reply_to_contact.py --unread
```

---

## 🎯 How Contact Lookup Works

Workflows accept multiple formats:
- **First name**: `"Rachel"` → Finds Rachael Gibson
- **Full name**: `"Rachael Gibson"`
- **Email**: `"rachael.gibson@crowe.com"`
- **Partial match**: `"gibson"` → Searches name/email/company

If multiple matches found, you'll be prompted to choose.

---

## 📄 Email Templates

Copy templates to `drafts/` and customize:

```bash
# 1. Copy template
cp templates/followup_template.md drafts/rachel_followup.md

# 2. Edit
nano drafts/rachel_followup.md

# 3. Send
python workflows/send_from_file.py drafts/rachel_followup.md
```

**Available templates**:
- `followup_template.md` - Follow-up emails
- `introduction_template.md` - Event introductions
- `partnership_template.md` - Partnership proposals
- `quick_update_template.md` - Status updates

---

## 🛠️ Setup & Configuration

### First Time Setup
1. See [docs/SETUP-GUIDE.md](docs/SETUP-GUIDE.md) for Google Cloud setup
2. Activate virtual environment: `source venv/bin/activate`
3. Install dependencies: `pip install -r requirements.txt`
4. Run any workflow script to authenticate

### Re-authentication
```bash
rm token.json
python workflows/draft_email.py  # Triggers OAuth flow
```

---

## 🗂️ Other Directories

### `examples/`
Example scripts demonstrating API usage. Great for learning.

```bash
python examples/email_manager_example.py
```

### `archive/`
Old test scripts and legacy code. Reference only.

### `config/`
Configuration files:
- `config.py` - App configuration
- `.env.example` - Environment variables template

---

## 🔑 Key Features

✅ **CRM Integration** - Look up contacts by name
✅ **File-Based Emails** - Write in markdown/text
✅ **Template System** - Reusable email templates
✅ **Draft Mode** - Review before sending
✅ **Email Threading** - Maintains conversation threads
✅ **Interactive & CLI** - Works both ways
✅ **HTML Support** - Send rich emails

---

## 💡 Pro Tips

### Tip 1: Keep Drafts Organized
```bash
drafts/
├── rachel_followup.md
├── team_updates/
│   ├── weekly_update.md
│   └── monthly_report.md
└── partnerships/
    └── proposal.md
```

### Tip 2: Use Descriptive Filenames
- ✅ `rachel_afrotech_followup.md`
- ❌ `email1.md`

### Tip 3: Keep CRM Updated
Add contacts before emailing:
```bash
cd "/Users/hoff/Desktop/My Drive/tools/automation/crm"
python contact_manager.py add "Name" "email@example.com" "Company"
```

### Tip 4: Review Before Sending
Use `--draft` flag to create drafts instead of sending immediately:
```bash
python workflows/send_from_file.py drafts/important.md --draft
```

---

## 🆘 Troubleshooting

### "No contact found"
Contact not in CRM. Add them:
```bash
cd "/Users/hoff/Desktop/My Drive/tools/automation/crm"
python contact_manager.py add "Name" "email@example.com" "Company"
```

### "Contact has no email address"
Update contact:
```bash
python contact_manager.py update "name" --email "email@example.com"
```

### Authentication Issues
Delete token and re-authenticate:
```bash
rm token.json
python workflows/draft_email.py
```

### Wrong Python Environment
Activate virtual environment:
```bash
source venv/bin/activate
which python  # Should show venv/bin/python
```

---

## 📚 API Modules

For developers building custom scripts:

```python
from modules import GoogleAuth, GmailAPI, SheetsAPI, DocsAPI

# Authenticate
auth = GoogleAuth()

# Use Gmail API
gmail = GmailAPI(auth)
emails = gmail.search_emails('subject:important')

# Use Sheets API
sheets = SheetsAPI(auth)
data = sheets.get_values(spreadsheet_id, 'Sheet1!A1:B10')
```

See [examples/](examples/) for more code samples.

---

## 🎓 Learning Path

1. **Start here**: [QUICKSTART.md](QUICKSTART.md)
2. **Try a workflow**: `python workflows/draft_email.py --to "Rachel"`
3. **Read full guide**: [docs/WORKFLOWS.md](docs/WORKFLOWS.md)
4. **Explore examples**: [examples/](examples/)
5. **Build custom scripts**: [modules/](modules/)

---

## 📞 Support

**Documentation Issues?** Check [docs/](docs/) directory

**Workflow Problems?** See [workflows/README.md](workflows/README.md)

**API Questions?** Read [examples/](examples/)

**Google API Docs**: https://developers.google.com/gmail/api

---

## 🔄 Quick Reference

| I want to... | Command |
|--------------|---------|
| Draft to Rachel | `python workflows/draft_email.py --to "Rachel"` |
| Send from file | `python workflows/send_from_file.py drafts/file.md` |
| Reply to Rachel | `python workflows/reply_to_contact.py --contact "Rachel"` |
| Check unread | `python workflows/reply_to_contact.py --unread` |
| List contacts | `cd crm && python contact_manager.py list` |
| Add contact | `cd crm && python contact_manager.py add "Name" "email" "Co"` |
| Use template | `cp templates/followup_template.md drafts/my.md` |
| Re-authenticate | `rm token.json` then run any workflow |

---

**Ready to start?** → See [QUICKSTART.md](QUICKSTART.md)
