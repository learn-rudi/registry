# Zoho Mail Stack

Send, search, and manage emails via Zoho Mail API.

## Quick Start

### 1. Create Zoho API Credentials

1. Go to [Zoho API Console](https://api-console.zoho.com/)
2. Click "Add Client" → "Server-based Applications"
3. Fill in:
   - Client Name: `Prompt Stack`
   - Homepage URL: `http://localhost`
   - Redirect URI: `http://localhost:8090/callback`
4. Copy the **Client ID** and **Client Secret**

### 2. Set Environment Variables

```bash
export ZOHO_CLIENT_ID="your-client-id"
export ZOHO_CLIENT_SECRET="your-client-secret"
export ZOHO_REGION="us"  # us, eu, in, au, jp
```

### 3. Authenticate

```bash
cd /path/to/zoho-mail
python3 -c "from modules.auth import ZohoAuth; auth = ZohoAuth(); auth.authenticate_interactive()"
```

This opens a browser for Zoho login. After authorizing, tokens are saved to `token.json`.

### 4. Add to Claude Code

```bash
claude mcp add --transport stdio zoho-mail -- python3 /path/to/zoho-mail/mcp_server.py
```

## Available Tools

| Tool | Description |
|------|-------------|
| `zoho_send_email` | Send an email |
| `zoho_create_draft` | Create a draft email |
| `zoho_search_email` | Search emails by query |
| `zoho_list_emails` | List emails in a folder |
| `zoho_get_email` | Get full email content |
| `zoho_list_folders` | List all mail folders |

## Usage Examples

### Send Email
```
Send an email to john@example.com with subject "Meeting Tomorrow" and body "Hi John, let's meet at 3pm."
```

### Search Emails
```
Search my Zoho mail for emails from support@company.com
```

### List Unread
```
Show me my unread emails in Zoho
```

### Create Draft
```
Create a draft email to team@company.com about the Q4 report
```

## Python Usage

```python
from modules.auth import ZohoAuth
from modules.mail import ZohoMail

# Initialize
auth = ZohoAuth()
mail = ZohoMail(auth)

# Send email
mail.send_email(
    to="recipient@example.com",
    subject="Hello",
    body="<h1>Hi there!</h1><p>This is a test email.</p>",
)

# Search
results = mail.search("from:boss@company.com")
for msg in results:
    print(f"{msg['subject']} - {msg['from']}")

# List folders
folders = mail.list_folders()
for f in folders:
    print(f"{f['name']}: {f['unread_count']} unread")
```

## Zoho Regions

| Region | accounts URL | mail URL |
|--------|-------------|----------|
| US | accounts.zoho.com | mail.zoho.com |
| EU | accounts.zoho.eu | mail.zoho.eu |
| India | accounts.zoho.in | mail.zoho.in |
| Australia | accounts.zoho.com.au | mail.zoho.com.au |
| Japan | accounts.zoho.jp | mail.zoho.jp |

Set `ZOHO_REGION` to match your Zoho account region.

## File Structure

```
zoho-mail/
├── mcp_server.py      # MCP server for Claude Code
├── modules/
│   ├── __init__.py
│   ├── auth.py        # OAuth2 authentication
│   └── mail.py        # Mail API wrapper
├── config/            # Store credentials here
├── token.json         # OAuth tokens (auto-generated)
├── manifest.json
└── STACK.md
```

## Troubleshooting

### "Not authenticated" error
Run the authentication flow:
```bash
python3 -c "from modules.auth import ZohoAuth; auth = ZohoAuth(); auth.authenticate_interactive()"
```

### "Invalid client" error
Check that `ZOHO_CLIENT_ID` and `ZOHO_CLIENT_SECRET` are set correctly.

### Wrong region
Set `ZOHO_REGION` to match where your Zoho account is hosted (us, eu, in, au, jp).

### Token expired
Tokens auto-refresh, but if issues persist, delete `token.json` and re-authenticate.

## License

MIT
