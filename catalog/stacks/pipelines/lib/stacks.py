"""
Stack Wrappers

Easy access to all available stacks from pipelines.
"""

import sys
import subprocess
from pathlib import Path

# Stack paths
STACKS_DIR = Path(__file__).parent.parent.parent
ANTHROPIC_STACK = STACKS_DIR / "anthropic-stack"
GOOGLE_AI_STACK = STACKS_DIR / "google-ai-studio"
GOOGLE_WORKSPACE_STACK = STACKS_DIR / "google-workspace"


# =============================================================================
# CLAUDE CLI - AI Agent via CLI
# =============================================================================

class ClaudeCLI:
    """Wrapper for Claude Code CLI"""

    def __init__(self):
        self.claude_cmd = "claude"  # Uses system claude

    async def ask(self, prompt: str, model: str = None) -> dict:
        """Simple query to Claude via CLI"""
        import asyncio

        cmd = [self.claude_cmd, "-p", prompt, "--output-format", "text"]
        if model:
            cmd.extend(["--model", model])

        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await proc.communicate()

        return {
            "text": stdout.decode().strip(),
            "success": proc.returncode == 0,
            "error": stderr.decode() if proc.returncode != 0 else None,
        }

    async def ask_haiku(self, prompt: str) -> dict:
        """Fast, cheap queries using Haiku"""
        return await self.ask(prompt, model="haiku")

    async def ask_sonnet(self, prompt: str) -> dict:
        """Balanced intelligence/speed using Sonnet"""
        return await self.ask(prompt, model="sonnet")

    async def ask_opus(self, prompt: str) -> dict:
        """Maximum intelligence using Opus"""
        return await self.ask(prompt, model="opus")

    async def agent(self, prompt: str, tools: list[str] = None, max_turns: int = 10) -> dict:
        """Run Claude with tools via CLI"""
        import asyncio

        cmd = [
            self.claude_cmd,
            "-p", prompt,
            "--output-format", "text",
            "--dangerously-skip-permissions",
            "--max-turns", str(max_turns),
        ]

        # Add allowed tools if specified
        if tools:
            for tool in tools:
                cmd.extend(["--allowedTools", tool])

        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await proc.communicate()

        return {
            "text": stdout.decode().strip(),
            "success": proc.returncode == 0,
            "error": stderr.decode() if proc.returncode != 0 else None,
        }


# Use claude instead of anthropic for consistency
claude = ClaudeCLI()
anthropic = claude  # Backwards compatibility alias


# =============================================================================
# GOOGLE AI STUDIO - Image/Video/Text Generation
# =============================================================================

class GoogleAIStack:
    """Wrapper for Google AI Studio (Gemini, Imagen, Veo)"""

    def __init__(self):
        self.stack_dir = GOOGLE_AI_STACK

    async def generate_image(
        self,
        prompt: str,
        model: str = "nano-banana",
        aspect: str = "16:9",
        output: str = None,
    ) -> dict:
        """Generate image with Gemini/Imagen"""
        cmd = [
            "node",
            str(self.stack_dir / "src/commands/generateImage.js"),
            prompt,
            "--model", model,
            "--aspect", aspect,
        ]
        if output:
            cmd.extend(["--output", output])

        result = subprocess.run(cmd, capture_output=True, text=True, cwd=str(self.stack_dir))

        return {
            "success": result.returncode == 0,
            "output": result.stdout,
            "error": result.stderr if result.returncode != 0 else None,
        }

    async def generate_video(
        self,
        prompt: str,
        fast: bool = False,
        output: str = None,
    ) -> dict:
        """Generate video with Veo"""
        cmd = [
            "node",
            str(self.stack_dir / "src/commands/generateVideo.js"),
            prompt,
        ]
        if fast:
            cmd.append("--fast")
        if output:
            cmd.extend(["--output", output])

        result = subprocess.run(cmd, capture_output=True, text=True, cwd=str(self.stack_dir))

        return {
            "success": result.returncode == 0,
            "output": result.stdout,
            "error": result.stderr if result.returncode != 0 else None,
        }


google_ai = GoogleAIStack()


# =============================================================================
# GOOGLE WORKSPACE - Gmail, Sheets, Docs, Drive
# =============================================================================

class GoogleWorkspaceStack:
    """Wrapper for Google Workspace tools"""

    def __init__(self):
        sys.path.insert(0, str(GOOGLE_WORKSPACE_STACK))
        self._auth = None
        self._gmail = None
        self._sheets = None
        self._docs = None
        self._drive = None
        # Credential paths
        self._creds_file = str(GOOGLE_WORKSPACE_STACK / "config" / "credentials.json")
        self._token_file = str(GOOGLE_WORKSPACE_STACK / "token.json")

    def _get_auth(self):
        if not self._auth:
            from modules.auth import GoogleAuth
            self._auth = GoogleAuth(
                credentials_file=self._creds_file,
                token_file=self._token_file,
            )
        return self._auth

    @property
    def gmail(self):
        if not self._gmail:
            from modules.gmail import GmailAPI
            self._gmail = GmailAPI(self._get_auth())
        return self._gmail

    @property
    def sheets(self):
        if not self._sheets:
            from modules.sheets import SheetsAPI
            self._sheets = SheetsAPI(self._get_auth())
        return self._sheets

    @property
    def docs(self):
        if not self._docs:
            from modules.docs import DocsAPI
            self._docs = DocsAPI(self._get_auth())
        return self._docs

    @property
    def drive(self):
        if not self._drive:
            from modules.drive import DriveAPI
            self._drive = DriveAPI(self._get_auth())
        return self._drive

    async def send_email(self, to: str, subject: str, body: str, html: bool = False) -> dict:
        """Send an email"""
        result = self.gmail.send_email(to, subject, body, html=html)
        return {"success": True, "message_id": result}

    async def create_draft(self, to: str, subject: str, body: str) -> dict:
        """Create email draft"""
        result = self.gmail.create_draft(to, subject, body)
        return {"success": True, "draft_id": result}

    async def read_sheet(self, spreadsheet_id: str, range: str) -> dict:
        """Read data from Google Sheet"""
        data = self.sheets.get_values(spreadsheet_id, range)
        return {"data": data}

    async def write_sheet(self, spreadsheet_id: str, range: str, values: list) -> dict:
        """Write data to Google Sheet"""
        result = self.sheets.update_values(spreadsheet_id, range, values)
        return {"success": True, "updated_cells": result}

    async def create_doc(self, title: str, content: str = "") -> dict:
        """Create a Google Doc"""
        doc_id = self.docs.create_document(title)
        if content:
            # Add content after creation
            self.docs.insert_text(doc_id, content, index=1)
        return {"doc_id": doc_id}

    async def upload_file(self, file_path: str, folder_id: str = None) -> dict:
        """Upload file to Drive"""
        result = self.drive.upload_file(file_path, folder_id)
        return {"file_id": result}


google_workspace = GoogleWorkspaceStack()
