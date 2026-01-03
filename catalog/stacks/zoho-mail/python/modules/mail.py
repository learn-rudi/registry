"""
Zoho Mail API Module

Send, search, and manage emails via Zoho Mail API.
"""

import requests
from typing import Optional, List, Dict, Any
from .auth import ZohoAuth


class ZohoMail:
    """Zoho Mail API wrapper."""

    def __init__(self, auth: ZohoAuth):
        self.auth = auth
        self._base_url = None

    @property
    def base_url(self) -> str:
        """Get the API base URL with account ID."""
        if not self._base_url:
            account_id = self.auth.get_account_id()
            self._base_url = f"{self.auth.get_mail_base_url()}/api/accounts/{account_id}"
        return self._base_url

    def _request(self, method: str, endpoint: str, **kwargs) -> dict:
        """Make an authenticated API request."""
        url = f"{self.base_url}{endpoint}"
        headers = self.auth.get_headers()

        try:
            response = requests.request(method, url, headers=headers, **kwargs)

            # Handle token refresh
            if response.status_code == 401:
                self.auth.refresh_token()
                headers = self.auth.get_headers()
                response = requests.request(method, url, headers=headers, **kwargs)

            response.raise_for_status()
            return response.json()
        except requests.exceptions.HTTPError as e:
            error_data = {}
            try:
                error_data = response.json()
            except:
                pass
            raise Exception(f"API Error: {e} - {error_data}")

    def send_email(
        self,
        to: str,
        subject: str,
        body: str,
        cc: str = None,
        bcc: str = None,
        from_address: str = None,
        html: bool = True,
        reply_to: str = None,
    ) -> dict:
        """
        Send an email.

        Args:
            to: Recipient email address(es), comma-separated for multiple
            subject: Email subject
            body: Email body content
            cc: CC recipients (optional)
            bcc: BCC recipients (optional)
            from_address: Sender address (optional, auto-detected from account)
            html: Send as HTML (default True)
            reply_to: Reply-to address (optional)

        Returns:
            dict with message details
        """
        # Use primary email with display name if not specified
        if not from_address:
            email = self.auth.get_primary_email()
            display_name = self.auth.get_display_name()
            if display_name:
                from_address = f"{display_name} <{email}>"
            else:
                from_address = email

        # Append signature to body
        full_body = body
        signature = self.auth.get_signature_content()
        if signature:
            full_body = f"{body}<br><br>{signature}"

        data = {
            "toAddress": to,
            "fromAddress": from_address,
            "subject": subject,
            "content": full_body,
            "mailFormat": "html" if html else "plaintext",
        }

        if cc:
            data["ccAddress"] = cc
        if bcc:
            data["bccAddress"] = bcc
        if reply_to:
            data["replyTo"] = reply_to

        result = self._request("POST", "/messages", json=data)
        return {
            "success": True,
            "message_id": result.get("data", {}).get("messageId"),
            "status": result.get("status", {}).get("description"),
        }

    def create_draft(
        self,
        to: str,
        subject: str,
        body: str,
        cc: str = None,
        bcc: str = None,
        from_address: str = None,
    ) -> dict:
        """
        Create an email draft.

        Args:
            to: Recipient email address(es)
            subject: Email subject
            body: Email body content
            cc: CC recipients (optional)
            bcc: BCC recipients (optional)
            from_address: Sender address (optional)

        Returns:
            dict with draft details
        """
        data = {
            "toAddress": to,
            "subject": subject,
            "content": body,
            "mailFormat": "html",
            "action": "draft",  # Save as draft instead of sending
        }

        if from_address:
            data["fromAddress"] = from_address
        if cc:
            data["ccAddress"] = cc
        if bcc:
            data["bccAddress"] = bcc

        result = self._request("POST", "/messages", json=data)
        return {
            "success": True,
            "draft_id": result.get("data", {}).get("messageId"),
            "status": result.get("status", {}).get("description"),
        }

    def search(
        self,
        query: str,
        folder: str = None,
        limit: int = 25,
        start: int = 0,
    ) -> List[dict]:
        """
        Search emails.

        Args:
            query: Search query string
            folder: Folder to search in (optional)
            limit: Max results to return
            start: Starting index for pagination

        Returns:
            List of matching emails
        """
        params = {
            "searchKey": query,
            "limit": limit,
            "start": start,
        }

        if folder:
            params["folderId"] = folder

        result = self._request("GET", "/messages/search", params=params)
        messages = result.get("data", [])

        return [
            {
                "message_id": msg.get("messageId"),
                "subject": msg.get("subject"),
                "from": msg.get("fromAddress"),
                "to": msg.get("toAddress"),
                "date": msg.get("receivedTime"),
                "summary": msg.get("summary", ""),
                "has_attachment": msg.get("hasAttachment", False),
                "is_read": msg.get("isRead", False),
            }
            for msg in messages
        ]

    def list_emails(
        self,
        folder_id: str = None,
        limit: int = 25,
        start: int = 0,
        status: str = None,
    ) -> List[dict]:
        """
        List emails in a folder.

        Args:
            folder_id: Folder ID (default: inbox)
            limit: Max results
            start: Starting index
            status: Filter by status (unread, read, flagged)

        Returns:
            List of emails
        """
        # Default to inbox
        if not folder_id:
            folders = self.list_folders()
            inbox = next((f for f in folders if f["name"].lower() == "inbox"), None)
            folder_id = inbox["folder_id"] if inbox else None

        params = {
            "limit": limit,
            "start": start,
        }

        if folder_id:
            params["folderId"] = folder_id

        if status:
            params["status"] = status

        result = self._request("GET", "/messages/view", params=params)
        messages = result.get("data", [])

        return [
            {
                "message_id": msg.get("messageId"),
                "subject": msg.get("subject"),
                "from": msg.get("fromAddress"),
                "to": msg.get("toAddress"),
                "date": msg.get("receivedTime"),
                "summary": msg.get("summary", ""),
                "has_attachment": msg.get("hasAttachment", False),
                "is_read": msg.get("isRead", False),
            }
            for msg in messages
        ]

    def get_email(self, message_id: str, folder_id: str = None) -> dict:
        """
        Get full email content.

        Args:
            message_id: The message ID
            folder_id: Folder ID (optional, defaults to inbox)

        Returns:
            Full email details including body
        """
        # Default to inbox if no folder specified
        if not folder_id:
            folders = self.list_folders()
            inbox = next((f for f in folders if f["name"].lower() == "inbox"), None)
            folder_id = inbox["folder_id"] if inbox else None

        # Get message content - requires folder in path
        result = self._request("GET", f"/folders/{folder_id}/messages/{message_id}/content")
        msg = result.get("data", {})

        return {
            "message_id": msg.get("messageId"),
            "subject": msg.get("subject"),
            "from": msg.get("fromAddress"),
            "to": msg.get("toAddress"),
            "cc": msg.get("ccAddress"),
            "date": msg.get("receivedTime"),
            "body": msg.get("content", ""),
            "has_attachment": msg.get("hasAttachment", False),
            "attachments": msg.get("attachments", []),
        }

    def list_folders(self) -> List[dict]:
        """
        List all mail folders.

        Returns:
            List of folders
        """
        result = self._request("GET", "/folders")
        folders = result.get("data", [])

        return [
            {
                "folder_id": f.get("folderId"),
                "name": f.get("folderName"),
                "path": f.get("folderPath"),
                "unread_count": f.get("unreadCount", 0),
                "total_count": f.get("mailCount", 0),
            }
            for f in folders
        ]

    def mark_as_read(self, message_id: str) -> bool:
        """Mark a message as read."""
        self._request("PUT", f"/messages/{message_id}", json={"isRead": True})
        return True

    def mark_as_unread(self, message_id: str) -> bool:
        """Mark a message as unread."""
        self._request("PUT", f"/messages/{message_id}", json={"isRead": False})
        return True

    def delete_email(self, message_id: str) -> bool:
        """Move email to trash."""
        self._request("DELETE", f"/messages/{message_id}")
        return True

    def move_to_folder(self, message_id: str, folder_id: str) -> bool:
        """Move email to a different folder."""
        self._request("PUT", f"/messages/{message_id}/move", json={"folderId": folder_id})
        return True
