#!/usr/bin/env python3
"""
Zoho Mail MCP Server

Provides Zoho Mail functionality to Claude Code via MCP protocol.
"""

import sys
import json
import asyncio
from pathlib import Path

# Load environment variables from .env file
from dotenv import load_dotenv
load_dotenv(Path(__file__).parent / ".env")

# Add modules to path
sys.path.insert(0, str(Path(__file__).parent))

from modules.auth import ZohoAuth
from modules.mail import ZohoMail

# MCP Protocol implementation
async def handle_request(request: dict) -> dict:
    """Handle incoming MCP requests."""
    method = request.get("method")
    params = request.get("params", {})

    if method == "initialize":
        return {
            "protocolVersion": "2024-11-05",
            "serverInfo": {
                "name": "zoho-mail",
                "version": "1.0.0",
            },
            "capabilities": {
                "tools": {},
            },
        }

    elif method == "tools/list":
        return {
            "tools": [
                {
                    "name": "zoho_send_email",
                    "description": "Send an email via Zoho Mail",
                    "inputSchema": {
                        "type": "object",
                        "properties": {
                            "to": {"type": "string", "description": "Recipient email address(es), comma-separated"},
                            "subject": {"type": "string", "description": "Email subject"},
                            "body": {"type": "string", "description": "Email body content (HTML supported)"},
                            "cc": {"type": "string", "description": "CC recipients (optional)"},
                            "bcc": {"type": "string", "description": "BCC recipients (optional)"},
                        },
                        "required": ["to", "subject", "body"],
                    },
                },
                {
                    "name": "zoho_create_draft",
                    "description": "Create an email draft in Zoho Mail",
                    "inputSchema": {
                        "type": "object",
                        "properties": {
                            "to": {"type": "string", "description": "Recipient email address(es)"},
                            "subject": {"type": "string", "description": "Email subject"},
                            "body": {"type": "string", "description": "Email body content"},
                            "cc": {"type": "string", "description": "CC recipients (optional)"},
                        },
                        "required": ["to", "subject", "body"],
                    },
                },
                {
                    "name": "zoho_search_email",
                    "description": "Search emails in Zoho Mail",
                    "inputSchema": {
                        "type": "object",
                        "properties": {
                            "query": {"type": "string", "description": "Search query (e.g., 'from:user@example.com', 'subject:meeting')"},
                            "limit": {"type": "integer", "description": "Max results (default 25)"},
                        },
                        "required": ["query"],
                    },
                },
                {
                    "name": "zoho_list_emails",
                    "description": "List emails in inbox or folder",
                    "inputSchema": {
                        "type": "object",
                        "properties": {
                            "folder_id": {"type": "string", "description": "Folder ID (optional, defaults to inbox)"},
                            "limit": {"type": "integer", "description": "Max results (default 25)"},
                            "status": {"type": "string", "description": "Filter: unread, read, flagged (optional)"},
                        },
                    },
                },
                {
                    "name": "zoho_get_email",
                    "description": "Get full email content by message ID",
                    "inputSchema": {
                        "type": "object",
                        "properties": {
                            "message_id": {"type": "string", "description": "The message ID"},
                        },
                        "required": ["message_id"],
                    },
                },
                {
                    "name": "zoho_list_folders",
                    "description": "List all mail folders",
                    "inputSchema": {
                        "type": "object",
                        "properties": {},
                    },
                },
            ],
        }

    elif method == "tools/call":
        tool_name = params.get("name")
        arguments = params.get("arguments", {})

        try:
            # Initialize auth and mail client
            auth = ZohoAuth(
                token_file=str(Path(__file__).parent / "token.json"),
            )

            if not auth.is_authenticated():
                return {
                    "content": [
                        {
                            "type": "text",
                            "text": "Error: Not authenticated. Please run authentication first:\n\npython -c \"from modules.auth import ZohoAuth; auth = ZohoAuth(); auth.authenticate_interactive()\"",
                        }
                    ],
                    "isError": True,
                }

            mail = ZohoMail(auth)

            # Handle tool calls
            if tool_name == "zoho_send_email":
                result = mail.send_email(
                    to=arguments["to"],
                    subject=arguments["subject"],
                    body=arguments["body"],
                    cc=arguments.get("cc"),
                    bcc=arguments.get("bcc"),
                )
                return {
                    "content": [
                        {
                            "type": "text",
                            "text": f"Email sent successfully!\nMessage ID: {result.get('message_id')}",
                        }
                    ],
                }

            elif tool_name == "zoho_create_draft":
                result = mail.create_draft(
                    to=arguments["to"],
                    subject=arguments["subject"],
                    body=arguments["body"],
                    cc=arguments.get("cc"),
                )
                return {
                    "content": [
                        {
                            "type": "text",
                            "text": f"Draft created successfully!\nDraft ID: {result.get('draft_id')}",
                        }
                    ],
                }

            elif tool_name == "zoho_search_email":
                results = mail.search(
                    query=arguments["query"],
                    limit=arguments.get("limit", 25),
                )
                output = f"Found {len(results)} emails:\n\n"
                for msg in results:
                    output += f"- [{msg['message_id']}] {msg['subject']}\n"
                    output += f"  From: {msg['from']} | Date: {msg['date']}\n"
                    if msg['summary']:
                        output += f"  {msg['summary'][:100]}...\n"
                    output += "\n"
                return {
                    "content": [{"type": "text", "text": output}],
                }

            elif tool_name == "zoho_list_emails":
                results = mail.list_emails(
                    folder_id=arguments.get("folder_id"),
                    limit=arguments.get("limit", 25),
                    status=arguments.get("status"),
                )
                output = f"Found {len(results)} emails:\n\n"
                for msg in results:
                    read_status = "📖" if msg['is_read'] else "📩"
                    output += f"{read_status} [{msg['message_id']}] {msg['subject']}\n"
                    output += f"   From: {msg['from']} | {msg['date']}\n"
                return {
                    "content": [{"type": "text", "text": output}],
                }

            elif tool_name == "zoho_get_email":
                result = mail.get_email(arguments["message_id"])
                output = f"Subject: {result['subject']}\n"
                output += f"From: {result['from']}\n"
                output += f"To: {result['to']}\n"
                if result['cc']:
                    output += f"CC: {result['cc']}\n"
                output += f"Date: {result['date']}\n"
                output += f"\n--- Body ---\n{result['body']}"
                return {
                    "content": [{"type": "text", "text": output}],
                }

            elif tool_name == "zoho_list_folders":
                folders = mail.list_folders()
                output = "Mail Folders:\n\n"
                for f in folders:
                    output += f"📁 {f['name']} ({f['unread_count']} unread / {f['total_count']} total)\n"
                    output += f"   ID: {f['folder_id']}\n"
                return {
                    "content": [{"type": "text", "text": output}],
                }

            else:
                return {
                    "content": [{"type": "text", "text": f"Unknown tool: {tool_name}"}],
                    "isError": True,
                }

        except Exception as e:
            return {
                "content": [{"type": "text", "text": f"Error: {str(e)}"}],
                "isError": True,
            }

    return {"error": {"code": -32601, "message": f"Unknown method: {method}"}}


async def main():
    """Main MCP server loop."""
    while True:
        try:
            line = sys.stdin.readline()
            if not line:
                break

            request = json.loads(line)
            response = await handle_request(request)

            # Add JSON-RPC fields - wrap in "result" for success, keep "error" for errors
            if "error" in response:
                output = {
                    "jsonrpc": "2.0",
                    "id": request.get("id"),
                    "error": response["error"],
                }
            else:
                output = {
                    "jsonrpc": "2.0",
                    "id": request.get("id"),
                    "result": response,
                }

            sys.stdout.write(json.dumps(output) + "\n")
            sys.stdout.flush()

        except json.JSONDecodeError:
            continue
        except Exception as e:
            error_response = {
                "jsonrpc": "2.0",
                "id": None,
                "error": {"code": -32603, "message": str(e)},
            }
            sys.stdout.write(json.dumps(error_response) + "\n")
            sys.stdout.flush()


if __name__ == "__main__":
    asyncio.run(main())
