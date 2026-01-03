#!/usr/bin/env python3
"""
Google Workspace MCP Server

Exposes Gmail, Sheets, Docs, Drive as tools for Claude Code.
Supports multiple Google accounts.
"""

import json
import os
import sys
from pathlib import Path

# Add modules to path
sys.path.insert(0, str(Path(__file__).parent))

from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import Tool, TextContent

# Initialize server
server = Server("google-workspace")

# Multi-account support
ACCOUNTS_DIR = Path(__file__).parent / "accounts"
_current_account = None
_auth = None
_gmail = None
_sheets = None
_docs = None
_drive = None


def get_available_accounts():
    """List all configured accounts"""
    accounts = []
    if ACCOUNTS_DIR.exists():
        for account_dir in ACCOUNTS_DIR.iterdir():
            if account_dir.is_dir() and (account_dir / "token.json").exists():
                accounts.append(account_dir.name)
    return accounts


def switch_account(account_name):
    """Switch to a different account"""
    global _current_account, _auth, _gmail, _sheets, _docs, _drive, _calendar

    account_dir = ACCOUNTS_DIR / account_name
    if not account_dir.exists() or not (account_dir / "token.json").exists():
        return False

    # Reset all cached services
    _auth = None
    _gmail = None
    _sheets = None
    _docs = None
    _drive = None
    _calendar = None
    _current_account = account_name
    return True


def get_current_account():
    """Get current account name"""
    global _current_account
    if not _current_account:
        accounts = get_available_accounts()
        _current_account = accounts[0] if accounts else None
    return _current_account


def get_auth():
    global _auth
    if not _auth:
        from modules.auth import GoogleAuth

        account = get_current_account()
        if account:
            # Use account-specific credentials
            account_dir = ACCOUNTS_DIR / account
            creds_path = account_dir / "credentials.json"
            token_path = account_dir / "token.json"
        else:
            # Fallback to legacy paths
            creds_path = Path(__file__).parent / "config" / "credentials.json"
            token_path = Path(__file__).parent / "token.json"

        _auth = GoogleAuth(
            credentials_file=str(creds_path),
            token_file=str(token_path),
        )
    return _auth


def get_gmail():
    global _gmail
    if not _gmail:
        from modules.gmail import GmailAPI
        _gmail = GmailAPI(get_auth())
    return _gmail


def get_sheets():
    global _sheets
    if not _sheets:
        from modules.sheets import SheetsAPI
        _sheets = SheetsAPI(get_auth())
    return _sheets


def get_docs():
    global _docs
    if not _docs:
        from modules.docs import DocsAPI
        _docs = DocsAPI(get_auth())
    return _docs


def get_drive():
    global _drive
    if not _drive:
        from modules.drive import DriveAPI
        _drive = DriveAPI(get_auth())
    return _drive


_calendar = None

def get_calendar():
    global _calendar
    if not _calendar:
        from modules.calendar import CalendarAPI
        _calendar = CalendarAPI(get_auth())
    return _calendar


# =============================================================================
# TOOL DEFINITIONS
# =============================================================================

@server.list_tools()
async def list_tools():
    return [
        # Account Management
        Tool(
            name="account_list",
            description="List all configured Google accounts",
            inputSchema={
                "type": "object",
                "properties": {},
            },
        ),
        Tool(
            name="account_switch",
            description="Switch to a different Google account",
            inputSchema={
                "type": "object",
                "properties": {
                    "account": {"type": "string", "description": "Account name to switch to (e.g., 'personal', 'work')"},
                },
                "required": ["account"],
            },
        ),
        Tool(
            name="account_current",
            description="Show the currently active Google account",
            inputSchema={
                "type": "object",
                "properties": {},
            },
        ),
        # Gmail
        Tool(
            name="gmail_send",
            description="Send an email via Gmail",
            inputSchema={
                "type": "object",
                "properties": {
                    "to": {"type": "string", "description": "Recipient email address"},
                    "subject": {"type": "string", "description": "Email subject"},
                    "body": {"type": "string", "description": "Email body text"},
                },
                "required": ["to", "subject", "body"],
            },
        ),
        Tool(
            name="gmail_draft",
            description="Create an email draft in Gmail",
            inputSchema={
                "type": "object",
                "properties": {
                    "to": {"type": "string", "description": "Recipient email address"},
                    "subject": {"type": "string", "description": "Email subject"},
                    "body": {"type": "string", "description": "Email body text"},
                },
                "required": ["to", "subject", "body"],
            },
        ),
        Tool(
            name="gmail_search",
            description="Search emails in Gmail",
            inputSchema={
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Gmail search query (e.g., 'from:someone@example.com', 'subject:meeting', 'is:unread')"},
                    "max_results": {"type": "integer", "description": "Maximum number of results (default: 10)", "default": 10},
                },
                "required": ["query"],
            },
        ),
        # Sheets
        Tool(
            name="sheets_read",
            description="Read data from a Google Sheet",
            inputSchema={
                "type": "object",
                "properties": {
                    "spreadsheet_id": {"type": "string", "description": "The spreadsheet ID (from the URL)"},
                    "range": {"type": "string", "description": "Cell range to read (e.g., 'Sheet1!A1:B10')"},
                },
                "required": ["spreadsheet_id", "range"],
            },
        ),
        Tool(
            name="sheets_write",
            description="Write data to a Google Sheet",
            inputSchema={
                "type": "object",
                "properties": {
                    "spreadsheet_id": {"type": "string", "description": "The spreadsheet ID"},
                    "range": {"type": "string", "description": "Cell range to write (e.g., 'Sheet1!A1')"},
                    "values": {"type": "array", "description": "2D array of values to write", "items": {"type": "array"}},
                },
                "required": ["spreadsheet_id", "range", "values"],
            },
        ),
        Tool(
            name="sheets_append",
            description="Append rows to a Google Sheet",
            inputSchema={
                "type": "object",
                "properties": {
                    "spreadsheet_id": {"type": "string", "description": "The spreadsheet ID"},
                    "range": {"type": "string", "description": "Sheet name or range (e.g., 'Sheet1')"},
                    "values": {"type": "array", "description": "2D array of rows to append", "items": {"type": "array"}},
                },
                "required": ["spreadsheet_id", "range", "values"],
            },
        ),
        # Docs
        Tool(
            name="docs_create",
            description="Create a new Google Doc",
            inputSchema={
                "type": "object",
                "properties": {
                    "title": {"type": "string", "description": "Document title"},
                    "content": {"type": "string", "description": "Initial content (optional)"},
                },
                "required": ["title"],
            },
        ),
        Tool(
            name="docs_read",
            description="Read content from a Google Doc",
            inputSchema={
                "type": "object",
                "properties": {
                    "document_id": {"type": "string", "description": "The document ID (from the URL)"},
                },
                "required": ["document_id"],
            },
        ),
        Tool(
            name="docs_insert_image",
            description="Insert an image into a Google Doc from a URL",
            inputSchema={
                "type": "object",
                "properties": {
                    "document_id": {"type": "string", "description": "The document ID"},
                    "image_url": {"type": "string", "description": "Public URL of the image to insert"},
                    "index": {"type": "integer", "description": "Position to insert (default: 1, start of doc)", "default": 1},
                },
                "required": ["document_id", "image_url"],
            },
        ),
        # Drive
        Tool(
            name="drive_list",
            description="List files in Google Drive",
            inputSchema={
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Search query (e.g., \"name contains 'report'\")"},
                    "folder_id": {"type": "string", "description": "Folder ID to list (optional)"},
                    "max_results": {"type": "integer", "description": "Maximum results (default: 20)", "default": 20},
                },
            },
        ),
        Tool(
            name="drive_upload",
            description="Upload a file to Google Drive",
            inputSchema={
                "type": "object",
                "properties": {
                    "file_path": {"type": "string", "description": "Local file path to upload"},
                    "folder_id": {"type": "string", "description": "Destination folder ID (optional)"},
                    "name": {"type": "string", "description": "Name for the file in Drive (optional, uses local name if not provided)"},
                },
                "required": ["file_path"],
            },
        ),
        Tool(
            name="drive_make_public",
            description="Make a Drive file publicly viewable and get a direct URL (useful for embedding images in Docs)",
            inputSchema={
                "type": "object",
                "properties": {
                    "file_id": {"type": "string", "description": "The file ID to make public"},
                },
                "required": ["file_id"],
            },
        ),
        Tool(
            name="drive_delete",
            description="Delete a file from Google Drive",
            inputSchema={
                "type": "object",
                "properties": {
                    "file_id": {"type": "string", "description": "The file ID to delete"},
                },
                "required": ["file_id"],
            },
        ),
        Tool(
            name="gmail_send_with_attachment",
            description="Send an email with file attachments",
            inputSchema={
                "type": "object",
                "properties": {
                    "to": {"type": "string", "description": "Recipient email address(es), comma-separated"},
                    "subject": {"type": "string", "description": "Email subject"},
                    "body": {"type": "string", "description": "Email body text"},
                    "attachments": {"type": "array", "items": {"type": "string"}, "description": "List of file paths to attach"},
                },
                "required": ["to", "subject", "body", "attachments"],
            },
        ),
        # Calendar
        Tool(
            name="calendar_list",
            description="List upcoming calendar events",
            inputSchema={
                "type": "object",
                "properties": {
                    "days": {"type": "integer", "description": "Number of days to look ahead (default: 7)", "default": 7},
                    "max_results": {"type": "integer", "description": "Maximum events (default: 20)", "default": 20},
                },
            },
        ),
        Tool(
            name="calendar_create",
            description="Create a new calendar event",
            inputSchema={
                "type": "object",
                "properties": {
                    "summary": {"type": "string", "description": "Event title"},
                    "start": {"type": "string", "description": "Start datetime (ISO format, e.g., '2026-01-15T14:00:00')"},
                    "end": {"type": "string", "description": "End datetime (ISO format, e.g., '2026-01-15T15:00:00')"},
                    "description": {"type": "string", "description": "Event description (optional)"},
                    "location": {"type": "string", "description": "Event location (optional)"},
                },
                "required": ["summary", "start", "end"],
            },
        ),
        Tool(
            name="calendar_quick_add",
            description="Create an event using natural language (e.g., 'Meeting with John tomorrow at 3pm')",
            inputSchema={
                "type": "object",
                "properties": {
                    "text": {"type": "string", "description": "Natural language event description"},
                },
                "required": ["text"],
            },
        ),
        Tool(
            name="calendar_delete",
            description="Delete a calendar event",
            inputSchema={
                "type": "object",
                "properties": {
                    "event_id": {"type": "string", "description": "Event ID to delete"},
                },
                "required": ["event_id"],
            },
        ),
    ]


# =============================================================================
# TOOL HANDLERS
# =============================================================================

@server.call_tool()
async def call_tool(name: str, arguments: dict):
    try:
        # Account Management
        if name == "account_list":
            accounts = get_available_accounts()
            current = get_current_account()
            lines = ["Available Google accounts:"]
            for acc in accounts:
                marker = " (active)" if acc == current else ""
                lines.append(f"  • {acc}{marker}")
            if not accounts:
                lines.append("  No accounts configured. Run auth flow to add one.")
            return [TextContent(type="text", text="\n".join(lines))]

        elif name == "account_switch":
            account_name = arguments["account"]
            if switch_account(account_name):
                return [TextContent(type="text", text=f"Switched to account: {account_name}")]
            else:
                available = get_available_accounts()
                return [TextContent(type="text", text=f"Account '{account_name}' not found. Available: {', '.join(available)}")]

        elif name == "account_current":
            current = get_current_account()
            if current:
                # Try to get email address from Gmail profile
                try:
                    gmail = get_gmail()
                    profile = gmail.get_profile()
                    email = profile.get('emailAddress', 'unknown')
                    return [TextContent(type="text", text=f"Current account: {current}\nEmail: {email}")]
                except:
                    return [TextContent(type="text", text=f"Current account: {current}")]
            else:
                return [TextContent(type="text", text="No account configured")]

        # Gmail
        elif name == "gmail_send":
            gmail = get_gmail()
            result = gmail.send_email(
                arguments["to"],
                arguments["subject"],
                arguments["body"],
            )
            if result:
                return [TextContent(type="text", text=f"Email sent successfully. Message ID: {result['id']}")]
            else:
                return [TextContent(type="text", text="Failed to send email")]

        elif name == "gmail_draft":
            gmail = get_gmail()
            result = gmail.create_draft(
                arguments["to"],
                arguments["subject"],
                arguments["body"],
            )
            return [TextContent(type="text", text=f"Draft created successfully. Draft ID: {result}")]

        elif name == "gmail_search":
            gmail = get_gmail()
            results = gmail.search_emails(
                arguments["query"],
                max_results=arguments.get("max_results", 10),
            )
            return [TextContent(type="text", text=json.dumps(results, indent=2))]

        # Sheets
        elif name == "sheets_read":
            sheets = get_sheets()
            data = sheets.get_values(
                arguments["spreadsheet_id"],
                arguments["range"],
            )
            return [TextContent(type="text", text=json.dumps(data, indent=2))]

        elif name == "sheets_write":
            sheets = get_sheets()
            result = sheets.update_values(
                arguments["spreadsheet_id"],
                arguments["range"],
                arguments["values"],
            )
            return [TextContent(type="text", text=f"Updated {result} cells")]

        elif name == "sheets_append":
            sheets = get_sheets()
            result = sheets.append_values(
                arguments["spreadsheet_id"],
                arguments["range"],
                arguments["values"],
            )
            return [TextContent(type="text", text=f"Appended {result} rows")]

        # Docs
        elif name == "docs_create":
            docs = get_docs()
            doc_id = docs.create_document(arguments["title"])
            if arguments.get("content"):
                docs.insert_text(doc_id, arguments["content"], index=1)
            return [TextContent(type="text", text=f"Document created. ID: {doc_id}\nURL: https://docs.google.com/document/d/{doc_id}")]

        elif name == "docs_read":
            docs = get_docs()
            content = docs.read_content(arguments["document_id"])
            return [TextContent(type="text", text=content)]

        elif name == "docs_insert_image":
            docs = get_docs()
            result = docs.insert_image(
                arguments["document_id"],
                arguments["image_url"],
                index=arguments.get("index", 1),
            )
            if result:
                return [TextContent(type="text", text=f"Image inserted into document")]
            else:
                return [TextContent(type="text", text="Failed to insert image")]

        # Drive
        elif name == "drive_list":
            drive = get_drive()
            files = drive.list_files(
                query=arguments.get("query"),
                folder_id=arguments.get("folder_id"),
                page_size=arguments.get("max_results", 20),
            )
            return [TextContent(type="text", text=json.dumps(files, indent=2))]

        elif name == "drive_upload":
            drive = get_drive()
            file_id = drive.upload_file(
                arguments["file_path"],
                parent_id=arguments.get("folder_id"),
                file_name=arguments.get("name"),
            )
            return [TextContent(type="text", text=f"File uploaded. ID: {file_id}\nURL: https://drive.google.com/file/d/{file_id}")]

        elif name == "drive_make_public":
            drive = get_drive()
            public_url = drive.make_public(arguments["file_id"])
            if public_url:
                return [TextContent(type="text", text=f"File is now public.\nDirect URL: {public_url}")]
            else:
                return [TextContent(type="text", text="Failed to make file public")]

        elif name == "drive_delete":
            drive = get_drive()
            if drive.delete_file(arguments["file_id"]):
                return [TextContent(type="text", text=f"File deleted successfully")]
            else:
                return [TextContent(type="text", text="Failed to delete file")]

        elif name == "gmail_send_with_attachment":
            gmail = get_gmail()
            result = gmail.send_email_with_attachments(
                arguments["to"],
                arguments["subject"],
                arguments["body"],
                arguments["attachments"],
            )
            if result:
                return [TextContent(type="text", text=f"Email sent with attachments. Message ID: {result['id']}")]
            else:
                return [TextContent(type="text", text="Failed to send email with attachments")]

        # Calendar
        elif name == "calendar_list":
            calendar = get_calendar()
            events = calendar.list_events(
                days=arguments.get("days", 7),
                max_results=arguments.get("max_results", 20),
            )
            if events:
                lines = ["Upcoming events:"]
                for event in events:
                    start = event['start']
                    if 'T' in start:
                        from datetime import datetime
                        dt = datetime.fromisoformat(start.replace('Z', '+00:00'))
                        date_str = dt.strftime('%a %b %d @ %I:%M %p')
                    else:
                        date_str = start
                    lines.append(f"\n• {event['summary']}")
                    lines.append(f"  {date_str}")
                    if event['location']:
                        lines.append(f"  📍 {event['location']}")
                return [TextContent(type="text", text="\n".join(lines))]
            else:
                return [TextContent(type="text", text="No upcoming events")]

        elif name == "calendar_create":
            calendar = get_calendar()
            event = calendar.create_event(
                summary=arguments["summary"],
                start=arguments["start"],
                end=arguments["end"],
                description=arguments.get("description", ""),
                location=arguments.get("location", ""),
            )
            if event:
                return [TextContent(type="text", text=f"Event created: {event['summary']}\nLink: {event.get('htmlLink', '')}")]
            else:
                return [TextContent(type="text", text="Failed to create event")]

        elif name == "calendar_quick_add":
            calendar = get_calendar()
            event = calendar.quick_add(arguments["text"])
            if event:
                return [TextContent(type="text", text=f"Event created: {event.get('summary', 'Untitled')}\nLink: {event.get('htmlLink', '')}")]
            else:
                return [TextContent(type="text", text="Failed to create event")]

        elif name == "calendar_delete":
            calendar = get_calendar()
            if calendar.delete_event(arguments["event_id"]):
                return [TextContent(type="text", text="Event deleted successfully")]
            else:
                return [TextContent(type="text", text="Failed to delete event")]

        else:
            return [TextContent(type="text", text=f"Unknown tool: {name}")]

    except Exception as e:
        return [TextContent(type="text", text=f"Error: {str(e)}")]


# =============================================================================
# MAIN
# =============================================================================

async def main():
    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream, server.create_initialization_options())


if __name__ == "__main__":
    import asyncio
    asyncio.run(main())
