import sys
from pathlib import Path
from datetime import datetime, timedelta
sys.path.insert(0, str(Path(__file__).parent.parent))

from modules import GoogleAuth, CalendarAPI

def main():
    auth = GoogleAuth()
    auth.authenticate()

    calendar = CalendarAPI(auth)

    # List all calendars
    print("\n📅 Your Calendars:")
    calendars = calendar.list_calendars()
    for cal in calendars:
        print(f"  - {cal['summary']} ({cal['id']})")

    # Get upcoming events
    print("\n📆 Upcoming events (next 7 days):")
    events = calendar.get_upcoming_events(days=7)
    if events:
        for event in events:
            start = event['start'].get('dateTime', event['start'].get('date'))
            print(f"  - {event['summary']} @ {start}")
    else:
        print("  No upcoming events")

    # Create a test event
    print("\n✨ Creating a test event...")
    start = datetime.now() + timedelta(days=1, hours=2)
    end = start + timedelta(hours=1)

    event = calendar.create_event(
        summary="Test Event from API",
        start=start,
        end=end,
        description="This event was created via the Google Workspace API integration",
        location="Virtual",
        reminders={
            'useDefault': False,
            'overrides': [
                {'method': 'popup', 'minutes': 30},
            ]
        }
    )

    if event:
        print(f"  Event ID: {event['id']}")
        print(f"  Link: {event['htmlLink']}")

    # Quick add using natural language
    print("\n🗣️ Creating event with natural language...")
    quick_event = calendar.quick_add("Coffee meeting next Monday at 10am")
    if quick_event:
        print(f"  Created: {quick_event['summary']}")

    # Get today's events
    print("\n📋 Today's events:")
    today_events = calendar.get_today_events()
    if today_events:
        for event in today_events:
            start = event['start'].get('dateTime', event['start'].get('date'))
            print(f"  - {event['summary']} @ {start}")
    else:
        print("  No events today")

if __name__ == '__main__':
    main()
