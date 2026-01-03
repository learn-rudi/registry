import base64
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.mime.base import MIMEBase
from email import encoders
from pathlib import Path
from googleapiclient.errors import HttpError
from .auth import GoogleAuth


class GmailAPI:
    def __init__(self, auth: GoogleAuth):
        self.auth = auth
        self.service = auth.get_service('gmail', 'v1')

    def send_message(self, to, subject, body, body_type='plain', cc=None, bcc=None, attachments=None):
        """
        Send an email message

        Args:
            to: Recipient email address or list of addresses
            subject: Email subject
            body: Email body content
            body_type: 'plain' or 'html'
            cc: CC recipients (string or list)
            bcc: BCC recipients (string or list)
            attachments: List of file paths to attach

        Returns:
            Message object if successful, None otherwise
        """
        try:
            message = self._create_message(to, subject, body, body_type, cc, bcc, attachments)
            sent_message = self.service.users().messages().send(
                userId='me',
                body=message
            ).execute()
            print(f"✅ Message sent successfully (ID: {sent_message['id']})")
            return sent_message
        except HttpError as error:
            print(f'❌ An error occurred: {error}')
            return None

    def send_email(self, to, subject, body, cc=None, bcc=None):
        """Send an email (plain text by default)"""
        return self.send_message(to, subject, body, body_type='plain', cc=cc, bcc=bcc)

    def send_plain_email(self, to, subject, body, cc=None, bcc=None):
        """Send a plain text email (alias for send_email)"""
        return self.send_email(to, subject, body, cc=cc, bcc=bcc)

    def send_html_email(self, to, subject, html_body, cc=None, bcc=None):
        """Send an HTML email"""
        return self.send_message(to, subject, html_body, body_type='html', cc=cc, bcc=bcc)

    def send_email_with_attachments(self, to, subject, body, attachments, body_type='plain', cc=None, bcc=None):
        """Send an email with file attachments"""
        return self.send_message(to, subject, body, body_type, cc, bcc, attachments)

    def _create_message(self, to, subject, body, body_type='plain', cc=None, bcc=None, attachments=None):
        """Create a message for an email"""
        # Handle multiple recipients
        to_addrs = to if isinstance(to, str) else ', '.join(to)

        # Create message container
        if attachments:
            message = MIMEMultipart()
        else:
            message = MIMEText(body, body_type)
            message['to'] = to_addrs
            message['subject'] = subject
            if cc:
                message['cc'] = cc if isinstance(cc, str) else ', '.join(cc)
            if bcc:
                message['bcc'] = bcc if isinstance(bcc, str) else ', '.join(bcc)
            return {'raw': base64.urlsafe_b64encode(message.as_bytes()).decode()}

        # Add headers
        message['to'] = to_addrs
        message['subject'] = subject
        if cc:
            message['cc'] = cc if isinstance(cc, str) else ', '.join(cc)
        if bcc:
            message['bcc'] = bcc if isinstance(bcc, str) else ', '.join(bcc)

        # Add body
        message.attach(MIMEText(body, body_type))

        # Add attachments
        for file_path in attachments:
            self._attach_file(message, file_path)

        return {'raw': base64.urlsafe_b64encode(message.as_bytes()).decode()}

    def _attach_file(self, message, file_path):
        """Attach a file to the message"""
        path = Path(file_path)
        if not path.exists():
            print(f"⚠️  Warning: File not found: {file_path}")
            return

        with open(path, 'rb') as f:
            part = MIMEBase('application', 'octet-stream')
            part.set_payload(f.read())
            encoders.encode_base64(part)
            part.add_header('Content-Disposition', f'attachment; filename={path.name}')
            message.attach(part)

    def get_profile(self):
        """Get the authenticated user's Gmail profile"""
        try:
            profile = self.service.users().getProfile(userId='me').execute()
            return profile
        except HttpError as error:
            print(f'An error occurred: {error}')
            return None

    def list_labels(self):
        """List all labels in the user's mailbox"""
        try:
            results = self.service.users().labels().list(userId='me').execute()
            labels = results.get('labels', [])
            return labels
        except HttpError as error:
            print(f'An error occurred: {error}')
            return None

    def create_draft(self, to, subject, body, body_type='plain', cc=None, bcc=None, attachments=None):
        """
        Create a draft email

        Args:
            Same as send_message()

        Returns:
            Draft object if successful, None otherwise
        """
        try:
            message = self._create_message(to, subject, body, body_type, cc, bcc, attachments)
            draft = self.service.users().drafts().create(
                userId='me',
                body={'message': message}
            ).execute()
            print(f"✅ Draft created successfully (ID: {draft['id']})")
            return draft
        except HttpError as error:
            print(f'An error occurred: {error}')
            return None

    def search_emails(self, query, max_results=10):
        """
        Search for emails using Gmail search syntax

        Args:
            query: Gmail search query (e.g., "from:example@gmail.com", "subject:urgent", "is:unread")
            max_results: Maximum number of results to return

        Returns:
            List of message objects with details
        """
        try:
            results = self.service.users().messages().list(
                userId='me',
                q=query,
                maxResults=max_results
            ).execute()

            messages = results.get('messages', [])

            if not messages:
                print('No messages found.')
                return []

            # Get full details for each message
            detailed_messages = []
            for msg in messages:
                message_detail = self.get_message(msg['id'])
                if message_detail:
                    detailed_messages.append(message_detail)

            print(f"📧 Found {len(detailed_messages)} messages")
            return detailed_messages

        except HttpError as error:
            print(f'An error occurred: {error}')
            return []

    def get_message(self, message_id):
        """
        Get full details of a specific message

        Args:
            message_id: Gmail message ID

        Returns:
            Dictionary with message details
        """
        try:
            message = self.service.users().messages().get(
                userId='me',
                id=message_id,
                format='full'
            ).execute()

            # Extract headers
            headers = message['payload'].get('headers', [])
            subject = next((h['value'] for h in headers if h['name'].lower() == 'subject'), '')
            sender = next((h['value'] for h in headers if h['name'].lower() == 'from'), '')
            to = next((h['value'] for h in headers if h['name'].lower() == 'to'), '')
            date = next((h['value'] for h in headers if h['name'].lower() == 'date'), '')
            message_id_header = next((h['value'] for h in headers if h['name'].lower() == 'message-id'), '')

            # Extract body
            body = self._extract_body_from_payload(message['payload'])

            return {
                'id': message_id,
                'thread_id': message.get('threadId', ''),
                'subject': subject,
                'from': sender,
                'to': to,
                'date': date,
                'message_id': message_id_header,
                'snippet': message.get('snippet', ''),
                'body': body,
                'labels': message.get('labelIds', [])
            }

        except HttpError as error:
            print(f'An error occurred: {error}')
            return None

    def _extract_body_from_payload(self, payload):
        """Extract email body from payload (handles multipart messages)"""
        body = {'text': '', 'html': ''}

        if 'parts' in payload:
            for part in payload['parts']:
                if part['mimeType'] == 'text/plain' and 'data' in part['body']:
                    body['text'] = base64.urlsafe_b64decode(part['body']['data']).decode('utf-8', errors='ignore')
                elif part['mimeType'] == 'text/html' and 'data' in part['body']:
                    body['html'] = base64.urlsafe_b64decode(part['body']['data']).decode('utf-8', errors='ignore')
                elif 'parts' in part:
                    # Recursive for nested parts
                    nested = self._extract_body_from_payload(part)
                    if nested['text']:
                        body['text'] = nested['text']
                    if nested['html']:
                        body['html'] = nested['html']
        elif 'body' in payload and 'data' in payload['body']:
            decoded = base64.urlsafe_b64decode(payload['body']['data']).decode('utf-8', errors='ignore')
            if payload.get('mimeType') == 'text/html':
                body['html'] = decoded
            else:
                body['text'] = decoded

        return body

    def reply_to_message(self, message_id, body, body_type='plain'):
        """
        Reply to an existing email

        Args:
            message_id: ID of the message to reply to
            body: Reply body content
            body_type: 'plain' or 'html'

        Returns:
            Sent message object if successful, None otherwise
        """
        try:
            # Get original message
            original = self.get_message(message_id)
            if not original:
                print("Could not find original message")
                return None

            # Extract reply-to or from address
            from_addr = original['from']
            # Parse email from "Name <email@example.com>" format
            import re
            email_match = re.search(r'<(.+?)>', from_addr)
            reply_to = email_match.group(1) if email_match else from_addr

            # Create reply subject
            subject = original['subject']
            if not subject.lower().startswith('re:'):
                subject = f"Re: {subject}"

            # Create reply message
            if body_type == 'plain':
                message = MIMEText(body)
            else:
                message = MIMEText(body, 'html')

            message['to'] = reply_to
            message['subject'] = subject
            message['In-Reply-To'] = original['message_id']
            message['References'] = original['message_id']

            # Send with threading
            raw_message = base64.urlsafe_b64encode(message.as_bytes()).decode()
            sent = self.service.users().messages().send(
                userId='me',
                body={
                    'raw': raw_message,
                    'threadId': original['thread_id']
                }
            ).execute()

            print(f"✅ Reply sent successfully (ID: {sent['id']})")
            return sent

        except HttpError as error:
            print(f'An error occurred: {error}')
            return None

    def list_drafts(self, max_results=10):
        """
        List draft emails

        Args:
            max_results: Maximum number of drafts to return

        Returns:
            List of draft objects
        """
        try:
            results = self.service.users().drafts().list(
                userId='me',
                maxResults=max_results
            ).execute()

            drafts = results.get('drafts', [])
            print(f"📝 Found {len(drafts)} drafts")
            return drafts

        except HttpError as error:
            print(f'An error occurred: {error}')
            return []

    def get_draft(self, draft_id):
        """
        Get a specific draft by ID

        Args:
            draft_id: Draft ID

        Returns:
            Draft object with message details
        """
        try:
            draft = self.service.users().drafts().get(
                userId='me',
                id=draft_id
            ).execute()
            return draft
        except HttpError as error:
            print(f'An error occurred: {error}')
            return None

    def get_unread_emails(self, max_results=10):
        """Get unread emails"""
        return self.search_emails('is:unread', max_results)

    def get_emails_from(self, sender_email, max_results=10):
        """Get emails from a specific sender"""
        return self.search_emails(f'from:{sender_email}', max_results)
