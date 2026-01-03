#!/usr/bin/env python3
"""
Notion Workspace MCP Server

Exposes Notion pages, databases, and blocks as tools for Claude Code.
"""

import json
import os
import sys
from pathlib import Path

from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import Tool, TextContent

# Initialize server
server = Server("notion-workspace")

# Configuration
ENV_PATH = Path(__file__).parent / ".env"
DATABASES_PATH = Path(__file__).parent / "databases.json"

# Lazy-load client
_client = None
_databases = None


def load_env():
    """Load environment variables from .env file"""
    env = {}
    if ENV_PATH.exists():
        for line in ENV_PATH.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                key, value = line.split('=', 1)
                env[key.strip()] = value.strip()
    return env


def get_databases():
    """Get saved database aliases"""
    global _databases
    if _databases is None:
        if DATABASES_PATH.exists():
            _databases = json.loads(DATABASES_PATH.read_text())
        else:
            # Initialize from .env if DB_ prefixed vars exist
            _databases = {}
            env = load_env()
            for key, value in env.items():
                if key.startswith('DB_'):
                    name = key[3:].lower()
                    _databases[name] = value
                elif key == 'NOTION_DATABASE_ID':
                    _databases['default'] = value
            save_databases()
    return _databases


def save_databases():
    """Save database aliases"""
    dbs = get_databases()
    if dbs:
        DATABASES_PATH.write_text(json.dumps(dbs, indent=2))


def resolve_database_id(name_or_id):
    """Resolve a database name alias to ID, or return the ID if already an ID"""
    dbs = get_databases()
    # Check if it's an alias
    if name_or_id.lower() in dbs:
        return dbs[name_or_id.lower()]
    # Check if it looks like an ID (32 hex chars with optional dashes)
    clean = name_or_id.replace('-', '')
    if len(clean) == 32 and all(c in '0123456789abcdef' for c in clean.lower()):
        return name_or_id
    # Not found
    return None


def get_client():
    global _client
    if not _client:
        env = load_env()
        api_key = os.environ.get('NOTION_API_KEY') or env.get('NOTION_API_KEY')

        if not api_key:
            raise ValueError("NOTION_API_KEY not set in .env file")

        _client = NotionClient(api_key)
    return _client


class NotionClient:
    """Notion API client"""
    
    def __init__(self, api_key: str):
        import requests
        self.api_key = api_key
        self.base_url = 'https://api.notion.com/v1'
        self.headers = {
            'Authorization': f'Bearer {api_key}',
            'Content-Type': 'application/json',
            'Notion-Version': '2022-06-28'
        }
    
    def _request(self, method, endpoint, json_data=None, params=None):
        import requests
        url = f"{self.base_url}/{endpoint}"
        response = requests.request(
            method=method,
            url=url,
            headers=self.headers,
            json=json_data,
            params=params
        )
        if response.status_code not in [200, 201]:
            raise Exception(f"Notion API error: {response.status_code} - {response.text}")
        return response.json()
    
    def search(self, query, filter_type=None):
        """Search pages and databases"""
        data = {"query": query}
        if filter_type:
            data["filter"] = {"property": "object", "value": filter_type}
        return self._request('POST', 'search', json_data=data)
    
    def get_page(self, page_id):
        """Get a page by ID"""
        return self._request('GET', f'pages/{page_id}')
    
    def get_page_content(self, page_id):
        """Get page content (blocks)"""
        return self._request('GET', f'blocks/{page_id}/children')
    
    def create_page(self, parent_id, title, content_blocks=None, is_database=False):
        """Create a new page"""
        if is_database:
            parent = {"database_id": parent_id}
            properties = {"Name": {"title": [{"text": {"content": title}}]}}
        else:
            parent = {"page_id": parent_id}
            properties = {"title": {"title": [{"text": {"content": title}}]}}
        
        data = {"parent": parent, "properties": properties}
        if content_blocks:
            data["children"] = content_blocks
        
        return self._request('POST', 'pages', json_data=data)
    
    def update_page(self, page_id, properties):
        """Update page properties"""
        return self._request('PATCH', f'pages/{page_id}', json_data={"properties": properties})
    
    def delete_page(self, page_id):
        """Archive a page"""
        return self._request('PATCH', f'pages/{page_id}', json_data={"archived": True})
    
    def get_database(self, database_id):
        """Get database schema"""
        return self._request('GET', f'databases/{database_id}')
    
    def query_database(self, database_id, filter_obj=None, sorts=None, page_size=100):
        """Query a database"""
        data = {"page_size": page_size}
        if filter_obj:
            data["filter"] = filter_obj
        if sorts:
            data["sorts"] = sorts
        return self._request('POST', f'databases/{database_id}/query', json_data=data)
    
    def append_blocks(self, page_id, blocks):
        """Append blocks to a page"""
        return self._request('PATCH', f'blocks/{page_id}/children', json_data={"children": blocks})
    
    def list_databases(self):
        """List all accessible databases"""
        results = self.search("", filter_type="database")
        return results.get('results', [])


# =============================================================================
# TOOL DEFINITIONS
# =============================================================================

@server.list_tools()
async def list_tools():
    return [
        # Database Aliases
        Tool(
            name="notion_db_list",
            description="List saved database aliases (shortcuts for database IDs)",
            inputSchema={
                "type": "object",
                "properties": {},
            },
        ),
        Tool(
            name="notion_db_add",
            description="Add a database alias (e.g., 'tasks' -> database ID)",
            inputSchema={
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "Alias name (e.g., 'tasks', 'notes', 'projects')"},
                    "database_id": {"type": "string", "description": "Notion database ID (from URL)"},
                },
                "required": ["name", "database_id"],
            },
        ),
        Tool(
            name="notion_db_remove",
            description="Remove a database alias",
            inputSchema={
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "Alias name to remove"},
                },
                "required": ["name"],
            },
        ),
        # Search
        Tool(
            name="notion_search",
            description="Search Notion for pages and databases",
            inputSchema={
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Search query"},
                    "type": {"type": "string", "description": "Filter by 'page' or 'database' (optional)"},
                },
                "required": ["query"],
            },
        ),
        Tool(
            name="notion_get_page",
            description="Get a Notion page by ID",
            inputSchema={
                "type": "object",
                "properties": {
                    "page_id": {"type": "string", "description": "Page ID (from URL or search)"},
                },
                "required": ["page_id"],
            },
        ),
        Tool(
            name="notion_get_page_content",
            description="Get the content/blocks of a Notion page",
            inputSchema={
                "type": "object",
                "properties": {
                    "page_id": {"type": "string", "description": "Page ID"},
                },
                "required": ["page_id"],
            },
        ),
        Tool(
            name="notion_create_page",
            description="Create a new Notion page",
            inputSchema={
                "type": "object",
                "properties": {
                    "parent_id": {"type": "string", "description": "Parent page or database ID"},
                    "title": {"type": "string", "description": "Page title"},
                    "is_database": {"type": "boolean", "description": "True if parent is a database", "default": False},
                },
                "required": ["parent_id", "title"],
            },
        ),
        Tool(
            name="notion_delete_page",
            description="Archive/delete a Notion page",
            inputSchema={
                "type": "object",
                "properties": {
                    "page_id": {"type": "string", "description": "Page ID to delete"},
                },
                "required": ["page_id"],
            },
        ),
        Tool(
            name="notion_query_database",
            description="Query a Notion database (use alias like 'tasks' or full database ID)",
            inputSchema={
                "type": "object",
                "properties": {
                    "database": {"type": "string", "description": "Database alias (e.g., 'tasks') or database ID"},
                    "filter": {"type": "object", "description": "Notion filter object (optional)"},
                },
                "required": ["database"],
            },
        ),
        Tool(
            name="notion_list_databases",
            description="List all accessible Notion databases",
            inputSchema={
                "type": "object",
                "properties": {},
            },
        ),
        Tool(
            name="notion_append_content",
            description="Append content blocks to a Notion page",
            inputSchema={
                "type": "object",
                "properties": {
                    "page_id": {"type": "string", "description": "Page ID"},
                    "text": {"type": "string", "description": "Text content to append (creates paragraph blocks)"},
                },
                "required": ["page_id", "text"],
            },
        ),
    ]


# =============================================================================
# TOOL HANDLERS
# =============================================================================

@server.call_tool()
async def call_tool(name: str, arguments: dict):
    try:
        # Database alias management (doesn't need client)
        if name == "notion_db_list":
            dbs = get_databases()
            if dbs:
                lines = ["Saved database aliases:"]
                for name, db_id in dbs.items():
                    lines.append(f"  • {name}: {db_id[:8]}...{db_id[-4:]}")
                return [TextContent(type="text", text="\n".join(lines))]
            else:
                return [TextContent(type="text", text="No database aliases saved. Use notion_db_add to add one.")]

        elif name == "notion_db_add":
            dbs = get_databases()
            alias_name = arguments["name"].lower()
            dbs[alias_name] = arguments["database_id"]
            save_databases()
            return [TextContent(type="text", text=f"Added alias '{alias_name}' -> {arguments['database_id']}")]

        elif name == "notion_db_remove":
            dbs = get_databases()
            alias_name = arguments["name"].lower()
            if alias_name in dbs:
                del dbs[alias_name]
                save_databases()
                return [TextContent(type="text", text=f"Removed alias '{alias_name}'")]
            else:
                return [TextContent(type="text", text=f"Alias '{alias_name}' not found")]

        # Tools that need the Notion client
        client = get_client()

        if name == "notion_search":
            results = client.search(
                arguments["query"],
                filter_type=arguments.get("type")
            )
            # Simplify results
            items = []
            for r in results.get('results', [])[:10]:
                item = {
                    "id": r['id'],
                    "type": r['object'],
                }
                if r['object'] == 'page':
                    props = r.get('properties', {})
                    title_prop = props.get('title') or props.get('Name') or {}
                    if 'title' in title_prop:
                        titles = title_prop['title']
                        item['title'] = titles[0]['plain_text'] if titles else 'Untitled'
                    else:
                        item['title'] = 'Untitled'
                elif r['object'] == 'database':
                    titles = r.get('title', [])
                    item['title'] = titles[0]['plain_text'] if titles else 'Untitled Database'
                items.append(item)
            return [TextContent(type="text", text=json.dumps(items, indent=2))]
        
        elif name == "notion_get_page":
            page = client.get_page(arguments["page_id"])
            # Extract key info
            props = page.get('properties', {})
            title = 'Untitled'
            for key, val in props.items():
                if val.get('type') == 'title':
                    titles = val.get('title', [])
                    if titles:
                        title = titles[0]['plain_text']
                    break
            result = {
                "id": page['id'],
                "title": title,
                "created": page.get('created_time'),
                "updated": page.get('last_edited_time'),
                "url": page.get('url'),
            }
            return [TextContent(type="text", text=json.dumps(result, indent=2))]
        
        elif name == "notion_get_page_content":
            content = client.get_page_content(arguments["page_id"])
            # Extract text from blocks
            blocks = content.get('results', [])
            text_content = []
            for block in blocks:
                block_type = block.get('type')
                if block_type in ['paragraph', 'heading_1', 'heading_2', 'heading_3', 'bulleted_list_item', 'numbered_list_item']:
                    rich_text = block.get(block_type, {}).get('rich_text', [])
                    text = ''.join([t.get('plain_text', '') for t in rich_text])
                    if text:
                        prefix = ''
                        if block_type == 'heading_1':
                            prefix = '# '
                        elif block_type == 'heading_2':
                            prefix = '## '
                        elif block_type == 'heading_3':
                            prefix = '### '
                        elif block_type == 'bulleted_list_item':
                            prefix = '• '
                        elif block_type == 'numbered_list_item':
                            prefix = '1. '
                        text_content.append(f"{prefix}{text}")
            return [TextContent(type="text", text="\n".join(text_content) or "No text content")]
        
        elif name == "notion_create_page":
            page = client.create_page(
                arguments["parent_id"],
                arguments["title"],
                is_database=arguments.get("is_database", False)
            )
            return [TextContent(type="text", text=f"Page created!\nID: {page['id']}\nURL: {page.get('url', '')}")]
        
        elif name == "notion_delete_page":
            client.delete_page(arguments["page_id"])
            return [TextContent(type="text", text="Page archived/deleted")]
        
        elif name == "notion_query_database":
            db_id = resolve_database_id(arguments["database"])
            if not db_id:
                available = ", ".join(get_databases().keys())
                return [TextContent(type="text", text=f"Database '{arguments['database']}' not found. Available aliases: {available}")]
            results = client.query_database(
                db_id,
                filter_obj=arguments.get("filter")
            )
            # Simplify results
            items = []
            for r in results.get('results', [])[:20]:
                props = r.get('properties', {})
                item = {"id": r['id']}
                for key, val in props.items():
                    prop_type = val.get('type')
                    if prop_type == 'title':
                        titles = val.get('title', [])
                        item[key] = titles[0]['plain_text'] if titles else ''
                    elif prop_type == 'rich_text':
                        texts = val.get('rich_text', [])
                        item[key] = texts[0]['plain_text'] if texts else ''
                    elif prop_type == 'select':
                        sel = val.get('select')
                        item[key] = sel['name'] if sel else ''
                    elif prop_type == 'multi_select':
                        item[key] = [s['name'] for s in val.get('multi_select', [])]
                    elif prop_type == 'date':
                        date = val.get('date')
                        item[key] = date['start'] if date else ''
                    elif prop_type == 'checkbox':
                        item[key] = val.get('checkbox', False)
                    elif prop_type == 'number':
                        item[key] = val.get('number')
                items.append(item)
            return [TextContent(type="text", text=json.dumps(items, indent=2))]
        
        elif name == "notion_list_databases":
            databases = client.list_databases()
            items = []
            for db in databases[:10]:
                titles = db.get('title', [])
                items.append({
                    "id": db['id'],
                    "title": titles[0]['plain_text'] if titles else 'Untitled',
                    "url": db.get('url', '')
                })
            return [TextContent(type="text", text=json.dumps(items, indent=2))]
        
        elif name == "notion_append_content":
            # Convert text to paragraph blocks
            paragraphs = arguments["text"].split("\n\n")
            blocks = []
            for para in paragraphs:
                if para.strip():
                    blocks.append({
                        "object": "block",
                        "type": "paragraph",
                        "paragraph": {
                            "rich_text": [{"type": "text", "text": {"content": para.strip()}}]
                        }
                    })
            client.append_blocks(arguments["page_id"], blocks)
            return [TextContent(type="text", text=f"Appended {len(blocks)} paragraph(s) to page")]
        
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
