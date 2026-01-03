# Google Workspace API Setup Guide

## Prerequisites

- Python 3.7 or higher
- A Google account
- Access to Google Cloud Console

## Step-by-Step Setup

### 1. Create Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Click "Select a project" → "New Project"
3. Enter a project name (e.g., "Google Workspace Integration")
4. Click "Create"

### 2. Enable APIs

1. In the Cloud Console, go to "APIs & Services" → "Library"
2. Search for and enable each of the following:
   - Google Sheets API
   - Google Docs API
   - Google Slides API
   - Google Drive API

### 3. Create OAuth 2.0 Credentials

1. Go to "APIs & Services" → "Credentials"
2. Click "Create Credentials" → "OAuth client ID"
3. If prompted, configure the OAuth consent screen:
   - User Type: External
   - App name: Your app name
   - User support email: Your email
   - Developer contact: Your email
   - Add scopes (optional for testing)
   - Add test users: Your email
4. Back in "Create OAuth client ID":
   - Application type: Desktop app
   - Name: "Google Workspace Integration"
   - Click "Create"
5. Download the credentials file
6. Rename it to `credentials.json` and place it in the project root

### 4. Install Python Dependencies

```bash
cd /Users/hoff/Documents/tools/api-integrations/google-workspace
pip install -r requirements.txt
```

### 5. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` if you want to customize file paths.

### 6. Test Authentication

Run any example script:

```bash
python examples/sheets_example.py
```

A browser window will open for authentication. Sign in with your Google account and grant permissions. A `token.json` file will be created for future use.

## Troubleshooting

**"Access blocked: Authorization Error"**
- Make sure you've added your email as a test user in the OAuth consent screen

**"The file credentials.json is missing"**
- Download OAuth 2.0 credentials from Google Cloud Console
- Rename to `credentials.json` and place in project root

**"Invalid scope" error**
- Ensure all required APIs are enabled in Google Cloud Console

## Security Notes

- Never commit `credentials.json` or `token.json` to version control
- Both files are included in `.gitignore`
- Store credentials securely