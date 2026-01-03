#!/usr/bin/env python3
"""
Gmail API Example - Send Emails

This example demonstrates how to:
1. Send a plain text email
2. Send an HTML email
3. Send an email with attachments
4. Create a draft email
"""

import sys
from pathlib import Path

# Add parent directory to path to import modules
sys.path.insert(0, str(Path(__file__).parent.parent))

from modules import GoogleAuth, GmailAPI


def main():
    # Initialize authentication
    print("🔐 Authenticating with Google...")
    auth = GoogleAuth()

    # Initialize Gmail API
    gmail = GmailAPI(auth)

    # Get user profile
    print("\n📧 Getting Gmail profile...")
    profile = gmail.get_profile()
    if profile:
        print(f"   Authenticated as: {profile.get('emailAddress')}")

    # Example 1: Send a plain text email
    print("\n" + "="*50)
    print("Example 1: Send Plain Text Email")
    print("="*50)

    to_email = input("Enter recipient email: ")

    result = gmail.send_plain_email(
        to=to_email,
        subject="Test Email from Gmail API",
        body="Hello! This is a test email sent via the Gmail API."
    )

    # Example 2: Send HTML email (commented out by default)
    print("\n" + "="*50)
    print("Example 2: Send HTML Email (optional)")
    print("="*50)

    send_html = input("Send an HTML email? (y/n): ").lower()
    if send_html == 'y':
        html_body = """
        <html>
            <body>
                <h1>Hello from Gmail API!</h1>
                <p>This is an <strong>HTML</strong> email.</p>
                <ul>
                    <li>Feature 1</li>
                    <li>Feature 2</li>
                    <li>Feature 3</li>
                </ul>
            </body>
        </html>
        """

        gmail.send_html_email(
            to=to_email,
            subject="HTML Email Test",
            html_body=html_body
        )

    # Example 3: Send email with attachments (commented out by default)
    print("\n" + "="*50)
    print("Example 3: Send Email with Attachments (optional)")
    print("="*50)

    send_attachment = input("Send an email with attachment? (y/n): ").lower()
    if send_attachment == 'y':
        file_path = input("Enter file path to attach: ")

        gmail.send_email_with_attachments(
            to=to_email,
            subject="Email with Attachment",
            body="Please find the attached file.",
            attachments=[file_path]
        )

    # Example 4: Create a draft
    print("\n" + "="*50)
    print("Example 4: Create Draft Email (optional)")
    print("="*50)

    create_draft = input("Create a draft email? (y/n): ").lower()
    if create_draft == 'y':
        gmail.create_draft(
            to=to_email,
            subject="Draft Email",
            body="This is a draft email that you can review before sending."
        )

    # Example 5: Send to multiple recipients with CC/BCC
    print("\n" + "="*50)
    print("Example 5: Advanced - Multiple Recipients (optional)")
    print("="*50)

    send_multiple = input("Send to multiple recipients? (y/n): ").lower()
    if send_multiple == 'y':
        cc_email = input("Enter CC email (or press Enter to skip): ")
        bcc_email = input("Enter BCC email (or press Enter to skip): ")

        gmail.send_plain_email(
            to=to_email,
            subject="Email with CC/BCC",
            body="This email has CC and BCC recipients.",
            cc=cc_email if cc_email else None,
            bcc=bcc_email if bcc_email else None
        )

    print("\n✅ Done! Check your Gmail for sent messages.")


if __name__ == '__main__':
    main()
