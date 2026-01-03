#!/usr/bin/env python3
"""
Send Email from File - Send emails directly from markdown or text files

File Format:
  The file can contain email metadata at the top using YAML-style frontmatter:

  ---
  to: rachel
  subject: Follow-up from AfroTech
  cc: zach.ford@crowe.com
  ---

  Hi Rachel,

  Following up from our conversation...

  Alternatively, you can specify everything via command-line arguments.

Usage:
    # Send email from file with metadata
    python workflows/send_from_file.py drafts/my_email.md

    # Send with command-line overrides
    python workflows/send_from_file.py drafts/my_email.txt --to "Rachel" --subject "Quick Update"

    # Send HTML email
    python workflows/send_from_file.py drafts/newsletter.html --to "team@example.com" --html
"""

import sys
import argparse
import re
from pathlib import Path

# Add parent directory to path to import modules
sys.path.insert(0, str(Path(__file__).parent.parent))

from modules import GoogleAuth, GmailAPI

# Import contact manager from CRM directory
sys.path.insert(0, str(Path(__file__).parent.parent.parent.parent / 'automation' / 'crm'))
from contact_manager import ContactManager


def parse_frontmatter(content):
    """Parse YAML-style frontmatter from content"""
    frontmatter_pattern = r'^---\s*\n(.*?)\n---\s*\n(.*)$'
    match = re.match(frontmatter_pattern, content, re.DOTALL)

    if not match:
        return {}, content

    frontmatter_text = match.group(1)
    body = match.group(2).strip()

    metadata = {}
    for line in frontmatter_text.split('\n'):
        if ':' in line:
            key, value = line.split(':', 1)
            metadata[key.strip()] = value.strip()

    return metadata, body


def find_contact(cm, identifier):
    """Find a contact by name or email"""
    if not identifier:
        return None

    # Try exact email match first (if it looks like an email)
    if '@' in identifier:
        contact = cm.find_by_email(identifier)
        if contact:
            return contact
        # Return the email as-is if not in CRM
        return {'name': identifier, 'email': identifier}

    # Try searching by name
    results = cm.search_contacts(identifier)

    if not results:
        return None

    if len(results) == 1:
        return results[0]

    # Multiple matches - let user choose
    print(f"\n🔍 Found {len(results)} contacts matching '{identifier}':\n")
    for i, contact in enumerate(results, 1):
        email = contact.get('email', 'No email')
        company = contact.get('company', 'No company')
        print(f"{i}. {contact['name']} - {email} ({company})")

    while True:
        try:
            choice = input("\nSelect contact number: ")
            idx = int(choice) - 1
            if 0 <= idx < len(results):
                return results[idx]
            print("Invalid selection. Try again.")
        except (ValueError, KeyboardInterrupt):
            return None


def read_email_file(file_path):
    """Read and parse email file"""
    try:
        with open(file_path, 'r') as f:
            content = f.read()
        return parse_frontmatter(content)
    except FileNotFoundError:
        print(f"❌ File not found: {file_path}")
        return None, None
    except Exception as e:
        print(f"❌ Error reading file: {e}")
        return None, None


def resolve_recipients(cm, recipients):
    """Resolve a comma-separated list of recipients to email addresses"""
    if not recipients:
        return []

    emails = []
    for recipient in recipients.split(','):
        recipient = recipient.strip()
        if not recipient:
            continue

        # If it's already an email, use it
        if '@' in recipient:
            emails.append(recipient)
        else:
            # Look up in CRM
            contact = find_contact(cm, recipient)
            if contact and contact.get('email'):
                emails.append(contact['email'])
            else:
                print(f"⚠️  Could not find email for: {recipient}")

    return emails


def main():
    parser = argparse.ArgumentParser(
        description='Send emails from files with frontmatter metadata',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__
    )
    parser.add_argument('file', help='Path to email file (markdown or text)')
    parser.add_argument('--to', help='Override recipient (contact name or email)')
    parser.add_argument('--subject', help='Override subject line')
    parser.add_argument('--cc', help='CC recipients (comma-separated)')
    parser.add_argument('--bcc', help='BCC recipients (comma-separated)')
    parser.add_argument('--html', action='store_true', help='Send as HTML email')
    parser.add_argument('--draft', action='store_true', help='Create as draft instead of sending')

    args = parser.parse_args()

    # Initialize
    print("\n🔐 Authenticating...")
    auth = GoogleAuth()
    gmail = GmailAPI(auth)
    cm = ContactManager()

    try:
        profile = gmail.get_profile()
        print(f"✅ Authenticated as: {profile.get('emailAddress')}\n")
    except:
        print("✅ Authenticated\n")

    # Read and parse file
    print(f"📄 Reading file: {args.file}")
    metadata, body = read_email_file(args.file)

    if body is None:
        sys.exit(1)

    if not body.strip():
        print("❌ Email body is empty")
        sys.exit(1)

    # Get recipient (command-line overrides file)
    to_input = args.to or metadata.get('to')
    if not to_input:
        print("❌ No recipient specified. Use --to or add 'to:' in file frontmatter")
        sys.exit(1)

    print(f"\n🔍 Looking up recipient: {to_input}")
    contact = find_contact(cm, to_input)

    if not contact:
        print(f"❌ No contact found for '{to_input}'")
        sys.exit(1)

    to_email = contact.get('email')
    if not to_email:
        print(f"❌ Contact '{contact.get('name', to_input)}' has no email address")
        sys.exit(1)

    contact_name = contact.get('name', to_email)
    print(f"✅ Found: {contact_name} ({to_email})")

    # Get subject (command-line overrides file)
    subject = args.subject or metadata.get('subject')
    if not subject:
        print("❌ No subject specified. Use --subject or add 'subject:' in file frontmatter")
        sys.exit(1)

    # Get CC/BCC (command-line overrides file)
    cc_emails = None
    bcc_emails = None

    if args.cc or metadata.get('cc'):
        cc_input = args.cc or metadata.get('cc')
        cc_emails = resolve_recipients(cm, cc_input)
        if cc_emails:
            print(f"📧 CC: {', '.join(cc_emails)}")

    if args.bcc or metadata.get('bcc'):
        bcc_input = args.bcc or metadata.get('bcc')
        bcc_emails = resolve_recipients(cm, bcc_input)
        if bcc_emails:
            print(f"📧 BCC: {', '.join(bcc_emails)}")

    # Confirm before sending
    print(f"\n" + "="*80)
    print(f"📧 EMAIL PREVIEW")
    print("="*80)
    print(f"To: {to_email} ({contact_name})")
    if cc_emails:
        print(f"CC: {', '.join(cc_emails)}")
    if bcc_emails:
        print(f"BCC: {', '.join(bcc_emails)}")
    print(f"Subject: {subject}")
    print(f"Body Type: {'HTML' if args.html else 'Plain Text'}")
    print("-"*80)
    print(body[:500] + ("..." if len(body) > 500 else ""))
    print("="*80)

    if args.draft:
        confirm = input("\n📤 Create draft? (y/n): ").strip().lower()
    else:
        confirm = input("\n📤 Send email? (y/n): ").strip().lower()

    if confirm != 'y':
        print("❌ Cancelled")
        sys.exit(0)

    # Send or create draft
    try:
        body_type = 'html' if args.html else 'plain'

        if args.draft:
            print("\n📝 Creating draft...")
            draft = gmail.create_draft(
                to_email,
                subject,
                body,
                body_type=body_type,
                cc=cc_emails,
                bcc=bcc_emails
            )
            print(f"\n✅ Draft created successfully!")
            print(f"   Draft ID: {draft['id']}")
            print(f"\n💡 Open Gmail to review and send your draft")
        else:
            print("\n📤 Sending email...")
            if body_type == 'html':
                result = gmail.send_html_email(
                    to_email,
                    subject,
                    body,
                    cc=cc_emails,
                    bcc=bcc_emails
                )
            else:
                result = gmail.send_plain_email(
                    to_email,
                    subject,
                    body,
                    cc=cc_emails,
                    bcc=bcc_emails
                )
            print(f"\n✅ Email sent successfully!")
            print(f"   Message ID: {result['id']}")

    except Exception as e:
        print(f"\n❌ Error: {e}")
        sys.exit(1)


if __name__ == '__main__':
    main()
