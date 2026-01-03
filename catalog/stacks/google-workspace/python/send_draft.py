#!/usr/bin/env python3
"""
Send an email from a draft HTML file with frontmatter
"""

import sys
import json
from pathlib import Path
from datetime import datetime

# Add parent directory to path to import modules
sys.path.insert(0, str(Path(__file__).parent))

from modules import GoogleAuth, GmailAPI


def parse_email_file(file_path):
    """Parse email file with frontmatter"""
    with open(file_path, 'r') as f:
        content = f.read()

    # Split frontmatter and body
    parts = content.split('---\n', 2)
    if len(parts) < 3:
        raise ValueError("Invalid file format. Expected frontmatter between --- delimiters")

    # Parse frontmatter
    frontmatter = {}
    for line in parts[1].strip().split('\n'):
        if ':' in line:
            key, value = line.split(':', 1)
            frontmatter[key.strip()] = value.strip()

    # Get HTML body
    html_body = parts[2].strip()

    return frontmatter, html_body


def log_sent_email(to, subject, message_id, draft_file):
    """Log sent email to JSON file"""
    log_file = Path(__file__).parent / 'sent_emails_log.json'

    # Read existing log
    try:
        with open(log_file, 'r') as f:
            log_data = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        log_data = {
            "sent_emails": [],
            "metadata": {
                "version": "1.0",
                "last_updated": None,
                "total_emails": 0
            }
        }

    # Add new entry
    new_entry = {
        "timestamp": datetime.now().isoformat(),
        "to": to,
        "subject": subject,
        "message_id": message_id,
        "draft_file": draft_file
    }

    log_data["sent_emails"].append(new_entry)
    log_data["metadata"]["last_updated"] = datetime.now().isoformat()
    log_data["metadata"]["total_emails"] = len(log_data["sent_emails"])

    # Write updated log
    with open(log_file, 'w') as f:
        json.dump(log_data, f, indent=2)

    print(f"📝 Logged email to {log_file}")


def main():
    if len(sys.argv) < 2:
        print("Usage: python send_draft.py <path_to_email_file> [--yes]")
        sys.exit(1)

    file_path = sys.argv[1]
    auto_confirm = '--yes' in sys.argv or '-y' in sys.argv

    # Parse the email file
    print(f"📄 Reading email from: {file_path}")
    frontmatter, html_body = parse_email_file(file_path)

    # Extract email details
    to = frontmatter.get('to')
    subject = frontmatter.get('subject')

    if not to or not subject:
        print("❌ Error: Email file must have 'to' and 'subject' in frontmatter")
        sys.exit(1)

    print(f"\n📧 Email Details:")
    print(f"   To: {to}")
    print(f"   Subject: {subject}")
    print(f"\n💬 Body preview:")
    print(f"   {html_body[:100]}...")

    # Confirm before sending
    if not auto_confirm:
        confirm = input("\n🚀 Send this email? (yes/no): ").lower()
        if confirm not in ['yes', 'y']:
            print("❌ Email not sent")
            sys.exit(0)
    else:
        print("\n🚀 Auto-confirming send (--yes flag provided)")

    # Initialize authentication
    print("\n🔐 Authenticating with Google...")
    auth = GoogleAuth()

    # Initialize Gmail API
    gmail = GmailAPI(auth)

    # Send the email
    print("\n📤 Sending email...")
    result = gmail.send_html_email(
        to=to,
        subject=subject,
        html_body=html_body
    )

    if result:
        print("\n✅ Email sent successfully!")

        # Log the sent email
        log_sent_email(
            to=to,
            subject=subject,
            message_id=result.get('id'),
            draft_file=file_path
        )
    else:
        print("\n❌ Failed to send email")


if __name__ == '__main__':
    main()
