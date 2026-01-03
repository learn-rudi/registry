#!/usr/bin/env python3
"""
Draft Email Workflow - Create email drafts to contacts from your CRM

Usage:
    # Interactive mode - prompts for all details
    python workflows/draft_email.py

    # Draft to a contact by name
    python workflows/draft_email.py --to "Rachel"

    # Draft with subject and body
    python workflows/draft_email.py --to "Rachel" --subject "Follow-up" --body "Hi Rachel, following up..."

    # Draft from a file
    python workflows/draft_email.py --to "Rachel" --file drafts/my_email.md

    # Draft from a file with subject in filename
    python workflows/draft_email.py --to "zach.ford@crowe.com" --file drafts/contract_update.txt
"""

import sys
import argparse
from pathlib import Path

# Add parent directory to path to import modules
sys.path.insert(0, str(Path(__file__).parent.parent))

from modules import GoogleAuth, GmailAPI

# Import contact manager from CRM directory
sys.path.insert(0, str(Path(__file__).parent.parent.parent.parent / 'automation' / 'crm'))
from contact_manager import ContactManager


def find_contact(cm, identifier):
    """Find a contact by name or email"""
    # Try exact email match first
    contact = cm.find_by_email(identifier)
    if contact:
        return contact

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


def read_file(file_path):
    """Read email content from file"""
    try:
        with open(file_path, 'r') as f:
            return f.read()
    except FileNotFoundError:
        print(f"❌ File not found: {file_path}")
        return None
    except Exception as e:
        print(f"❌ Error reading file: {e}")
        return None


def interactive_mode(gmail, cm):
    """Interactive mode - prompt for all details"""
    print("\n" + "="*80)
    print("📧 DRAFT EMAIL - INTERACTIVE MODE")
    print("="*80 + "\n")

    # Get recipient
    to_input = input("To (name or email): ").strip()
    contact = find_contact(cm, to_input)

    if not contact:
        print(f"\n❌ No contact found for '{to_input}'")
        print("💡 Tip: You can still enter an email address directly")
        to_email = input("Enter email address (or press Enter to cancel): ").strip()
        if not to_email:
            return
        contact_name = to_email
    else:
        to_email = contact.get('email')
        if not to_email:
            print(f"\n⚠️  Contact '{contact['name']}' has no email address")
            to_email = input("Enter email address: ").strip()
            if not to_email:
                return
        contact_name = contact['name']
        print(f"✅ Found: {contact_name} ({to_email})")
        if contact.get('company'):
            print(f"   Company: {contact['company']}")
        if contact.get('role'):
            print(f"   Role: {contact['role']}")

    # Get subject
    print()
    subject = input("Subject: ").strip()
    if not subject:
        print("❌ Subject is required")
        return

    # Get body - option to use file or type
    print("\n📝 Body Options:")
    print("1. Type body now")
    print("2. Load from file")
    body_option = input("Choose option (1 or 2): ").strip()

    if body_option == "2":
        file_path = input("File path: ").strip()
        body = read_file(file_path)
        if not body:
            return
    else:
        print("\nEnter email body (press Ctrl+D or Ctrl+Z when done):")
        print("-" * 80)
        lines = []
        try:
            while True:
                line = input()
                lines.append(line)
        except EOFError:
            pass
        body = "\n".join(lines)

    if not body.strip():
        print("❌ Body is required")
        return

    # Create draft
    print("\n📤 Creating draft...")
    try:
        draft = gmail.create_draft(to_email, subject, body)
        print(f"\n✅ Draft created successfully!")
        print(f"   To: {to_email} ({contact_name})")
        print(f"   Subject: {subject}")
        print(f"   Draft ID: {draft['id']}")
        print(f"\n💡 Open Gmail to review and send your draft")
    except Exception as e:
        print(f"\n❌ Error creating draft: {e}")


def main():
    parser = argparse.ArgumentParser(
        description='Draft emails to contacts from your CRM',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__
    )
    parser.add_argument('--to', help='Contact name or email address')
    parser.add_argument('--subject', help='Email subject')
    parser.add_argument('--body', help='Email body text')
    parser.add_argument('--file', help='Path to file containing email body')
    parser.add_argument('--html', action='store_true', help='Treat body as HTML')

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

    # If no arguments, run interactive mode
    if not args.to:
        interactive_mode(gmail, cm)
        return

    # Command-line mode
    print(f"\n🔍 Looking up contact: {args.to}")
    contact = find_contact(cm, args.to)

    if not contact:
        print(f"❌ No contact found for '{args.to}'")
        print("💡 You can use the email address directly")
        to_email = args.to if '@' in args.to else None
        if not to_email:
            print("❌ Invalid email address")
            sys.exit(1)
        contact_name = to_email
    else:
        to_email = contact.get('email')
        if not to_email:
            print(f"⚠️  Contact '{contact['name']}' has no email address")
            sys.exit(1)
        contact_name = contact['name']
        print(f"✅ Found: {contact_name} ({to_email})")

    # Get subject
    if not args.subject:
        subject = input("\nSubject: ").strip()
    else:
        subject = args.subject

    if not subject:
        print("❌ Subject is required")
        sys.exit(1)

    # Get body
    if args.file:
        body = read_file(args.file)
        if not body:
            sys.exit(1)
    elif args.body:
        body = args.body
    else:
        print("\nEnter email body (press Ctrl+D or Ctrl+Z when done):")
        print("-" * 80)
        lines = []
        try:
            while True:
                line = input()
                lines.append(line)
        except EOFError:
            pass
        body = "\n".join(lines)

    if not body.strip():
        print("❌ Body is required")
        sys.exit(1)

    # Create draft
    print(f"\n📤 Creating draft to {contact_name}...")
    try:
        body_type = 'html' if args.html else 'plain'
        draft = gmail.create_draft(to_email, subject, body, body_type=body_type)
        print(f"\n✅ Draft created successfully!")
        print(f"   To: {to_email} ({contact_name})")
        print(f"   Subject: {subject}")
        print(f"   Draft ID: {draft['id']}")
        print(f"\n💡 Open Gmail to review and send your draft")
    except Exception as e:
        print(f"\n❌ Error creating draft: {e}")
        sys.exit(1)


if __name__ == '__main__':
    main()
