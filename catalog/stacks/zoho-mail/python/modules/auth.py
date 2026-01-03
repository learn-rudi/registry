"""
Zoho OAuth2 Authentication

Handles OAuth2 flow for Zoho Mail API access.
"""

import os
import json
import requests
from pathlib import Path
from typing import Optional
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlencode, parse_qs, urlparse
import webbrowser
import threading


# Zoho OAuth endpoints by region
ZOHO_REGIONS = {
    "us": {
        "accounts": "https://accounts.zoho.com",
        "mail": "https://mail.zoho.com",
    },
    "eu": {
        "accounts": "https://accounts.zoho.eu",
        "mail": "https://mail.zoho.eu",
    },
    "in": {
        "accounts": "https://accounts.zoho.in",
        "mail": "https://mail.zoho.in",
    },
    "au": {
        "accounts": "https://accounts.zoho.com.au",
        "mail": "https://mail.zoho.com.au",
    },
    "jp": {
        "accounts": "https://accounts.zoho.jp",
        "mail": "https://mail.zoho.jp",
    },
}

# Required scopes for mail operations
ZOHO_MAIL_SCOPES = [
    "ZohoMail.messages.ALL",
    "ZohoMail.folders.ALL",
    "ZohoMail.accounts.READ",
]


class ZohoAuth:
    """Handles Zoho OAuth2 authentication."""

    def __init__(
        self,
        client_id: str = None,
        client_secret: str = None,
        token_file: str = None,
        region: str = "us",
    ):
        self.client_id = client_id or os.getenv("ZOHO_CLIENT_ID")
        self.client_secret = client_secret or os.getenv("ZOHO_CLIENT_SECRET")
        self.region = region
        self.endpoints = ZOHO_REGIONS.get(region, ZOHO_REGIONS["us"])

        # Token storage
        self.token_file = token_file or str(
            Path(__file__).parent.parent / "token.json"
        )
        self.token_data = None
        self.account_id = None
        self.primary_email = None
        self.display_name = None
        self.signature_id = None
        self.signature_content = None

        # Load existing token if available
        self._load_token()

    def _load_token(self):
        """Load token from file if exists."""
        if os.path.exists(self.token_file):
            with open(self.token_file, "r") as f:
                self.token_data = json.load(f)
                self.account_id = self.token_data.get("account_id")
                self.primary_email = self.token_data.get("primary_email")
                self.display_name = self.token_data.get("display_name")
                self.signature_id = self.token_data.get("signature_id")
                self.signature_content = self.token_data.get("signature_content")

    def _save_token(self):
        """Save token to file."""
        with open(self.token_file, "w") as f:
            json.dump(self.token_data, f, indent=2)

    def get_authorization_url(self, redirect_uri: str = "http://localhost:8090/callback") -> str:
        """Generate OAuth2 authorization URL."""
        params = {
            "client_id": self.client_id,
            "response_type": "code",
            "access_type": "offline",
            "scope": ",".join(ZOHO_MAIL_SCOPES),
            "redirect_uri": redirect_uri,
            "prompt": "consent",
        }
        return f"{self.endpoints['accounts']}/oauth/v2/auth?{urlencode(params)}"

    def exchange_code(self, code: str, redirect_uri: str = "http://localhost:8090/callback") -> dict:
        """Exchange authorization code for tokens."""
        data = {
            "client_id": self.client_id,
            "client_secret": self.client_secret,
            "code": code,
            "grant_type": "authorization_code",
            "redirect_uri": redirect_uri,
        }

        response = requests.post(
            f"{self.endpoints['accounts']}/oauth/v2/token",
            data=data,
        )
        response.raise_for_status()

        token_data = response.json()
        self.token_data = token_data

        # Get account ID
        self._fetch_account_id()

        self._save_token()
        return token_data

    def refresh_token(self) -> dict:
        """Refresh the access token."""
        if not self.token_data or "refresh_token" not in self.token_data:
            raise ValueError("No refresh token available. Please re-authenticate.")

        data = {
            "client_id": self.client_id,
            "client_secret": self.client_secret,
            "refresh_token": self.token_data["refresh_token"],
            "grant_type": "refresh_token",
        }

        response = requests.post(
            f"{self.endpoints['accounts']}/oauth/v2/token",
            data=data,
        )
        response.raise_for_status()

        new_token = response.json()
        # Keep the refresh token (it's not returned on refresh)
        new_token["refresh_token"] = self.token_data["refresh_token"]
        new_token["account_id"] = self.token_data.get("account_id")
        self.token_data = new_token
        self._save_token()

        return new_token

    def _fetch_account_id(self):
        """Fetch the account ID, email, and signature for API calls."""
        headers = self.get_headers()
        response = requests.get(
            f"{self.endpoints['mail']}/api/accounts",
            headers=headers,
        )
        response.raise_for_status()

        data = response.json()
        if data.get("data"):
            account = data["data"][0]
            self.account_id = account["accountId"]
            self.primary_email = account.get("primaryEmailAddress")

            # Get display name and signature from sendMailDetails
            send_details = account.get("sendMailDetails", [])
            if send_details:
                self.display_name = send_details[0].get("displayName")
                self.signature_id = send_details[0].get("signatureId")

            self.token_data["account_id"] = self.account_id
            self.token_data["primary_email"] = self.primary_email
            self.token_data["display_name"] = self.display_name
            self.token_data["signature_id"] = self.signature_id

    def get_headers(self) -> dict:
        """Get authorization headers for API requests."""
        if not self.token_data or "access_token" not in self.token_data:
            raise ValueError("Not authenticated. Please run authentication flow.")

        return {
            "Authorization": f"Zoho-oauthtoken {self.token_data['access_token']}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

    def get_account_id(self) -> str:
        """Get the authenticated account ID."""
        if not self.account_id:
            self._fetch_account_id()
        return self.account_id

    def get_primary_email(self) -> str:
        """Get the authenticated user's primary email address."""
        if not self.primary_email:
            self._fetch_account_id()
            self._save_token()  # Cache it for next time
        return self.primary_email

    def get_display_name(self) -> str:
        """Get the authenticated user's display name (from signature)."""
        if not self.display_name:
            # First try signature (has proper capitalization)
            self._fetch_signature()
            # Fall back to account info if no signature
            if not self.display_name:
                self._fetch_account_id()
            self._save_token()
        return self.display_name

    def get_signature_id(self) -> str:
        """Get the user's email signature ID."""
        if not self.signature_id:
            self._fetch_account_id()
            self._save_token()
        return self.signature_id

    def get_signature_content(self) -> str:
        """Get the user's email signature HTML content."""
        if not self.signature_content:
            self._fetch_signature()
            self._save_token()
        return self.signature_content

    def _fetch_signature(self):
        """Fetch the user's signature content."""
        headers = self.get_headers()
        response = requests.get(
            f"{self.endpoints['mail']}/api/accounts/signature",
            headers=headers,
        )
        if response.status_code == 200:
            data = response.json()
            signatures = data.get("data", [])
            if signatures:
                # Use first signature (or match by signature_id if we have it)
                sig = signatures[0]
                if self.signature_id:
                    sig = next((s for s in signatures if s.get("id") == self.signature_id), sig)
                self.signature_content = sig.get("content", "")
                self.display_name = sig.get("name", self.display_name)
                self.token_data["signature_content"] = self.signature_content
                self.token_data["display_name"] = self.display_name

    def get_mail_base_url(self) -> str:
        """Get the mail API base URL."""
        return self.endpoints["mail"]

    def is_authenticated(self) -> bool:
        """Check if we have valid credentials."""
        return self.token_data is not None and "access_token" in self.token_data

    def authenticate_interactive(self, port: int = 8090):
        """Run interactive OAuth flow with local server."""
        redirect_uri = f"http://localhost:{port}/callback"
        auth_code = None

        class CallbackHandler(BaseHTTPRequestHandler):
            def do_GET(self):
                nonlocal auth_code
                query = parse_qs(urlparse(self.path).query)
                if "code" in query:
                    auth_code = query["code"][0]
                    self.send_response(200)
                    self.send_header("Content-type", "text/html")
                    self.end_headers()
                    self.wfile.write(b"<html><body><h1>Authentication successful!</h1><p>You can close this window.</p></body></html>")
                else:
                    self.send_response(400)
                    self.end_headers()
                    self.wfile.write(b"Error: No code received")

            def log_message(self, format, *args):
                pass  # Suppress logging

        # Start local server
        server = HTTPServer(("localhost", port), CallbackHandler)
        server_thread = threading.Thread(target=server.handle_request)
        server_thread.start()

        # Open browser
        auth_url = self.get_authorization_url(redirect_uri)
        print(f"\nOpening browser for Zoho authentication...")
        print(f"If browser doesn't open, visit:\n{auth_url}\n")
        webbrowser.open(auth_url)

        # Wait for callback
        server_thread.join(timeout=120)
        server.server_close()

        if auth_code:
            self.exchange_code(auth_code, redirect_uri)
            print("Authentication successful!")
            return True
        else:
            print("Authentication failed or timed out.")
            return False
