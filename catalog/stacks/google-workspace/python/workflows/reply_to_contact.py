#!/usr/bin/env python3
"""
Reply to Contact - Find and reply to the latest email from a contact

Usage:
    # Interactive mode - shows recent emails and prompts for reply
    python workflows/reply_to_contact.py --contact "Rachel"

    # Reply with message
    python workflows/reply_to_contact.py --contact "Rachel" --message "Thanks for the update!"

    # Reply from file
    python workflows/reply_to_contact.py --contact "zach.ford@crowe.com" --file drafts/reply.txt

    # Show all unread emails and reply
    python workflows/reply_to_contact.py --unread
"""

import sys
import argparse
from pathlib import Path
from datetime import datetime

# Add parent directory to path to import modules
sys.path.insert(0, str(Path(__file__).parent.parent))

from modules import GoogleAuth, GmailAPI

# Import contact manager from CRM directory
sys.path.insert(0, str(Path(__file__).parent.parent.parent.parent / 'automation' / 'crm'))
from contact_manager import ContactManager


def find_contact(cm, identifier):
    """Find a contact by name or email"""
    if not identifier:
        return None

    # Try exact email match first
    if '@' in identifier:
        contact = cm.find_by_email(identifier)
        if contact:
            return contact
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


def read_file(file_path):
    """Read reply content from file"""
    try:
        with open(file_path, 'r') as f:
            return f.read()
    except FileNotFoundError:
        print(f"❌ File not found: {file_path}")
        return None
    except Exception as e:
        print(f"❌ Error reading file: {e}")
        return None


def format_email_preview(email, idx=None):
    """Format email for display"""
    prefix = f"{idx}. " if idx is not None else ""
    date_str = email.get('date', 'Unknown date')
    subject = email.get('subject', 'No subject')
    snippet = email.get('snippet', '')[:100]

    output = f"{prefix}From: {email.get('from', 'Unknown')}\n"
    output += f"   Date: {date_str}\n"
    output += f"   Subject: {subject}\n"
    output += f"   Preview: {snippet}...\n"
    return output


def show_unread_and_reply(gmail, cm):
    """Show unread emails and allow replying"""
    print("\n📬 Fetching unread emails...")
    unread = gmail.get_unread_emails(max_results=20)

    if not unread:
        print("✅ No unread emails!")
        return

    print(f"\n{'='*100}")
    print(f"UNREAD EMAILS ({len(unread)} total)")
    print(f"{'='*100}\n")

    for i, email in enumerate(unread, 1):
        print(format_email_preview(email, i))

    # Let user select email to reply to
    print("\n" + "-"*100)
    choice = input("\nSelect email number to reply to (or press Enter to exit): ").strip()

    if not choice:
        return

    try:
        idx = int(choice) - 1
        if 0 <= idx < len(unread):
            selected_email = unread[idx]
            reply_to_email(gmail, selected_email)
        else:
            print("Invalid selection")
    except ValueError:
        print("Invalid input")


def reply_to_email(gmail, email, reply_body=None):
    """Reply to a specific email"""
    print(f"\n{'='*100}")
    print("📧 REPLYING TO EMAIL")
    print(f"{'='*100}")
    print(format_email_preview(email))
    print(f"{'='*100}\n")

    # Get reply body if not provided
    if not reply_body:
        print("Enter your reply (press Ctrl+D or Ctrl+Z when done):")
        print("-" * 80)
        lines = []
        try:
            while True:
                line = input()
                lines.append(line)
        except EOFError:
            pass
        reply_body = "\n".join(lines)

    if not reply_body.strip():
        print("❌ Reply body is required")
        return

    # Send reply
    print("\n📤 Sending reply...")
    try:
        result = gmail.reply_to_message(email['id'], reply_body)
        print(f"\n✅ Reply sent successfully!")
        print(f"   Message ID: {result['id']}")
    except Exception as e:
        print(f"\n❌ Error sending reply: {e}")


def main():
    parser = argparse.ArgumentParser(
        description='Reply to emails from contacts',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__
    )
    parser.add_argument('--contact', help='Contact name or email to find emails from')
    parser.add_argument('--message', help='Reply message text')
    parser.add_argument('--file', help='Path to file containing reply message')
    parser.add_argument('--unread', action='store_true', help='Show all unread emails')
    parser.add_argument('--limit', type=int, default=10, help='Number of emails to show (default: 10)')

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

    # Unread mode
    if args.unread:
        show_unread_and_reply(gmail, cm)
        return

    # Contact mode
    if not args.contact:
        print("❌ Please specify --contact or use --unread")
        print("\nExample: python workflows/reply_to_contact.py --contact 'Rachel'")
        sys.exit(1)

    # Find contact
    print(f"🔍 Looking up contact: {args.contact}")
    contact = find_contact(cm, args.contact)

    if not contact:
        print(f"❌ No contact found for '{args.contact}'")
        sys.exit(1)

    contact_email = contact.get('email')
    if not contact_email:
        print(f"❌ Contact '{contact.get('name', args.contact)}' has no email address")
        sys.exit(1)

    contact_name = contact.get('name', contact_email)
    print(f"✅ Found: {contact_name} ({contact_email})")

    # Get emails from contact
    print(f"\n📧 Fetching emails from {contact_name}...")
    emails = gmail.get_emails_from(contact_email, max_results=args.limit)

    if not emails:
        print(f"❌ No emails found from {contact_email}")
        sys.exit(1)

    print(f"\n{'='*100}")
    print(f"EMAILS FROM {contact_name.upper()} ({len(emails)} total)")
    print(f"{'='*100}\n")

    for i, email in enumerate(emails, 1):
        print(format_email_preview(email, i))

    # Select email to reply to
    print("\n" + "-"*100)
    choice = input("\nSelect email number to reply to (or press Enter for most recent): ").strip()

    if choice:
        try:
            idx = int(choice) - 1
            if 0 <= idx < len(emails):
                selected_email = emails[idx]
            else:
                print("Invalid selection, using most recent")
                selected_email = emails[0]
        except ValueError:
            print("Invalid input, using most recent")
            selected_email = emails[0]
    else:
        selected_email = emails[0]

    # Get reply body
    reply_body = None
    if args.file:
        reply_body = read_file(args.file)
        if not reply_body:
            sys.exit(1)
    elif args.message:
        reply_body = args.message

    # Send reply
    reply_to_email(gmail, selected_email, reply_body)


if __name__ == '__main__':
    main()
