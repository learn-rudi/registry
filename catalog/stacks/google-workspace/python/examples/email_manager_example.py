#!/usr/bin/env python3
"""
Gmail Manager Example - Search, Read, Reply, and Draft

This example demonstrates how to:
1. Search for emails
2. Read email content
3. Reply to emails
4. Create and manage drafts
5. Get unread emails
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

    print("\n✅ Authenticated successfully\n")

    while True:
        print("\n" + "="*60)
        print("Gmail Manager")
        print("="*60)
        print("1. Search emails")
        print("2. Get unread emails")
        print("3. Get emails from specific sender")
        print("4. Read an email")
        print("5. Reply to an email")
        print("6. Create draft")
        print("7. List drafts")
        print("8. Exit")
        print("="*60)

        choice = input("\nChoose an option (1-8): ").strip()

        if choice == '1':
            # Search emails
            query = input("Enter search query (e.g., 'subject:important', 'from:example.com'): ")
            max_results = input("Max results (default 10): ").strip() or "10"

            emails = gmail.search_emails(query, int(max_results))

            for i, email in enumerate(emails, 1):
                print(f"\n{i}. From: {email['from']}")
                print(f"   Subject: {email['subject']}")
                print(f"   Date: {email['date']}")
                print(f"   Snippet: {email['snippet'][:100]}...")
                print(f"   ID: {email['id']}")

        elif choice == '2':
            # Get unread emails
            max_results = input("Max results (default 10): ").strip() or "10"

            emails = gmail.get_unread_emails(int(max_results))

            if emails:
                for i, email in enumerate(emails, 1):
                    print(f"\n{i}. From: {email['from']}")
                    print(f"   Subject: {email['subject']}")
                    print(f"   Date: {email['date']}")
                    print(f"   Snippet: {email['snippet'][:100]}...")
                    print(f"   ID: {email['id']}")

        elif choice == '3':
            # Get emails from sender
            sender = input("Enter sender email: ")
            max_results = input("Max results (default 10): ").strip() or "10"

            emails = gmail.get_emails_from(sender, int(max_results))

            if emails:
                for i, email in enumerate(emails, 1):
                    print(f"\n{i}. Subject: {email['subject']}")
                    print(f"   Date: {email['date']}")
                    print(f"   Snippet: {email['snippet'][:100]}...")
                    print(f"   ID: {email['id']}")

        elif choice == '4':
            # Read an email
            message_id = input("Enter message ID: ")

            email = gmail.get_message(message_id)

            if email:
                print(f"\n{'='*60}")
                print(f"From: {email['from']}")
                print(f"To: {email['to']}")
                print(f"Subject: {email['subject']}")
                print(f"Date: {email['date']}")
                print(f"{'='*60}")
                print("\nBody:")
                body_text = email['body']['text'] or email['body']['html']
                print(body_text[:1000])  # Print first 1000 chars
                if len(body_text) > 1000:
                    print("\n... (truncated)")

        elif choice == '5':
            # Reply to email
            message_id = input("Enter message ID to reply to: ")

            # Show original email
            original = gmail.get_message(message_id)
            if original:
                print(f"\nReplying to:")
                print(f"From: {original['from']}")
                print(f"Subject: {original['subject']}")
                print(f"\nOriginal snippet: {original['snippet'][:200]}...\n")

                print("Enter your reply (press Enter twice when done):")
                lines = []
                empty_count = 0
                while True:
                    line = input()
                    if line == "":
                        empty_count += 1
                        if empty_count >= 2:
                            break
                    else:
                        empty_count = 0
                    lines.append(line)

                reply_body = "\n".join(lines)

                if reply_body.strip():
                    gmail.reply_to_message(message_id, reply_body)
                else:
                    print("Reply cancelled (empty body)")

        elif choice == '6':
            # Create draft
            to = input("To: ")
            subject = input("Subject: ")
            print("Body (press Enter twice when done):")

            lines = []
            empty_count = 0
            while True:
                line = input()
                if line == "":
                    empty_count += 1
                    if empty_count >= 2:
                        break
                else:
                    empty_count = 0
                lines.append(line)

            body = "\n".join(lines)

            if body.strip():
                gmail.create_draft(to, subject, body)

        elif choice == '7':
            # List drafts
            drafts = gmail.list_drafts()

            if drafts:
                print("\nYour drafts:")
                for i, draft in enumerate(drafts, 1):
                    print(f"{i}. Draft ID: {draft['id']}")
                    print(f"   Message ID: {draft['message']['id']}")

        elif choice == '8':
            print("\n👋 Goodbye!")
            break

        else:
            print("\n❌ Invalid option. Please choose 1-8.")


if __name__ == '__main__':
    main()
