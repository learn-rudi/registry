"""
Create test therapy session events for billing platform testing
Creates events that match the format expected by the calendar sync
"""
import sys
from pathlib import Path
from datetime import datetime, timedelta
sys.path.insert(0, str(Path(__file__).parent))

from modules import GoogleAuth, CalendarAPI

# Sample clients for testing
TEST_CLIENTS = [
    "Sarah Johnson",
    "Michael Chen",
    "Emily Rodriguez",
    "David Thompson",
    "Jennifer Williams"
]

# Session durations (will map to CPT codes)
DURATIONS = {
    "30min": 30,   # 90832
    "45min": 45,   # 90834
    "60min": 60,   # 90837
}

def create_therapy_sessions(calendar_api, num_sessions=10, days_back=30):
    """
    Create test therapy session events

    Args:
        calendar_api: CalendarAPI instance
        num_sessions: Number of sessions to create
        days_back: Create sessions within the last N days
    """
    print(f"\n🧪 Creating {num_sessions} test therapy sessions...")

    created_events = []

    for i in range(num_sessions):
        # Random client from test list
        client = TEST_CLIENTS[i % len(TEST_CLIENTS)]

        # Random duration (mostly 45min sessions)
        if i % 5 == 0:
            duration_key = "60min"
        elif i % 7 == 0:
            duration_key = "30min"
        else:
            duration_key = "45min"

        duration_minutes = DURATIONS[duration_key]

        # Create session in the past (for testing)
        days_ago = (days_back - (i * (days_back // num_sessions)))
        session_date = datetime.now() - timedelta(days=days_ago)

        # Set to business hours (9am-5pm)
        hour = 9 + (i % 8)
        session_date = session_date.replace(hour=hour, minute=0, second=0, microsecond=0)

        # End time
        end_time = session_date + timedelta(minutes=duration_minutes)

        # Determine if telehealth (every 3rd session)
        location = "Zoom - Telehealth" if i % 3 == 0 else "In-Person"

        # Create event with different title formats
        if i % 4 == 0:
            summary = f"{client} Therapy Session"
        elif i % 4 == 1:
            summary = f"{client} Appointment"
        elif i % 4 == 2:
            summary = f"{client}"
        else:
            summary = f"{client} Counseling"

        # Create the event
        event = calendar_api.create_event(
            summary=summary,
            start=session_date,
            end=end_time,
            description=f"Therapy session - {duration_key}",
            location=location,
            timezone="America/New_York"
        )

        if event:
            created_events.append({
                'client': client,
                'date': session_date.strftime('%Y-%m-%d %H:%M'),
                'duration': duration_minutes,
                'location': location,
                'event_id': event['id']
            })
            print(f"  ✅ {client} - {session_date.strftime('%Y-%m-%d %I:%M %p')} ({duration_minutes}min) - {location}")

    return created_events


def create_sessions_for_specific_dates(calendar_api, client_sessions):
    """
    Create sessions for specific dates and clients

    Args:
        calendar_api: CalendarAPI instance
        client_sessions: List of dicts with 'client', 'date', 'duration', 'location'
    """
    print(f"\n🎯 Creating {len(client_sessions)} specific sessions...")

    created_events = []

    for session in client_sessions:
        client = session['client']
        session_datetime = session['date']
        duration_minutes = session.get('duration', 45)
        location = session.get('location', 'In-Person')

        end_time = session_datetime + timedelta(minutes=duration_minutes)

        event = calendar_api.create_event(
            summary=f"{client} Session",
            start=session_datetime,
            end=end_time,
            description=f"Therapy session - {duration_minutes} minutes",
            location=location,
            timezone="America/New_York"
        )

        if event:
            created_events.append(event)
            print(f"  ✅ {client} - {session_datetime.strftime('%Y-%m-%d %I:%M %p')}")

    return created_events


def list_recent_therapy_sessions(calendar_api, days=30):
    """List recent therapy-like events"""
    print(f"\n📋 Recent therapy sessions (last {days} days):")

    time_min = datetime.now() - timedelta(days=days)
    events = calendar_api.get_events(
        time_min=time_min,
        max_results=100
    )

    if not events:
        print("  No events found")
        return []

    # Filter for client-like names (not meetings, etc.)
    therapy_events = []
    for event in events:
        summary = event.get('summary', '')
        start = event['start'].get('dateTime', event['start'].get('date'))
        location = event.get('location', 'Not specified')

        # Simple filter - contains common client name patterns
        if any(word in summary.lower() for word in ['session', 'therapy', 'counseling', 'appointment']) or \
           len(summary.split()) == 2:  # Likely "FirstName LastName"
            therapy_events.append(event)
            print(f"  - {summary} @ {start} | {location}")

    return therapy_events


def delete_test_events(calendar_api, event_ids):
    """Delete test events"""
    print(f"\n🗑️  Deleting {len(event_ids)} test events...")

    for event_id in event_ids:
        success = calendar_api.delete_event(event_id, send_updates='none')
        if success:
            print(f"  ✅ Deleted {event_id}")


def main():
    auth = GoogleAuth()
    auth.authenticate()
    calendar = CalendarAPI(auth)

    print("\n" + "="*60)
    print("   THERAPY SESSION TEST DATA CREATOR")
    print("="*60)

    # List available calendars
    print("\n📅 Your Calendars:")
    calendars = calendar.list_calendars()
    for i, cal in enumerate(calendars):
        print(f"  {i+1}. {cal['summary']} ({cal['id']})")

    print("\n" + "="*60)
    print("What would you like to do?")
    print("="*60)
    print("1. Create 10 random therapy sessions (last 30 days)")
    print("2. Create 20 random therapy sessions (last 60 days)")
    print("3. Create sessions for this week")
    print("4. List recent therapy sessions")
    print("5. Delete test events")
    print("0. Exit")
    print("="*60)

    choice = input("\nEnter choice (0-5): ").strip()

    if choice == "1":
        events = create_therapy_sessions(calendar, num_sessions=10, days_back=30)
        print(f"\n✨ Created {len(events)} therapy sessions!")

    elif choice == "2":
        events = create_therapy_sessions(calendar, num_sessions=20, days_back=60)
        print(f"\n✨ Created {len(events)} therapy sessions!")

    elif choice == "3":
        # Create sessions for this week (Mon-Fri, 9am-5pm)
        sessions = []
        today = datetime.now()
        # Find this Monday
        monday = today - timedelta(days=today.weekday())

        for day in range(5):  # Mon-Fri
            session_date = monday + timedelta(days=day)
            session_date = session_date.replace(hour=10, minute=0, second=0, microsecond=0)

            sessions.append({
                'client': TEST_CLIENTS[day % len(TEST_CLIENTS)],
                'date': session_date,
                'duration': 45,
                'location': 'In-Person' if day % 2 == 0 else 'Zoom - Telehealth'
            })

        events = create_sessions_for_specific_dates(calendar, sessions)
        print(f"\n✨ Created {len(events)} sessions for this week!")

    elif choice == "4":
        events = list_recent_therapy_sessions(calendar, days=60)
        print(f"\nFound {len(events)} therapy-like events")

    elif choice == "5":
        events = list_recent_therapy_sessions(calendar, days=60)
        if events:
            confirm = input(f"\n⚠️  Delete {len(events)} events? (yes/no): ")
            if confirm.lower() == 'yes':
                event_ids = [e['id'] for e in events]
                delete_test_events(calendar, event_ids)

    elif choice == "0":
        print("\n👋 Goodbye!")

    else:
        print("\n❌ Invalid choice")


if __name__ == '__main__':
    main()
