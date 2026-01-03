"""
Google Calendar API module
"""

from datetime import datetime, timedelta, timezone
from googleapiclient.errors import HttpError
from .auth import GoogleAuth


class CalendarAPI:
    def __init__(self, auth: GoogleAuth):
        self.auth = auth
        self.service = auth.get_service('calendar', 'v3')

    def list_events(self, days=7, max_results=20, calendar_id='primary'):
        """
        List upcoming calendar events

        Args:
            days: Number of days to look ahead (default: 7)
            max_results: Maximum events to return (default: 20)
            calendar_id: Calendar ID (default: 'primary')

        Returns:
            List of event dictionaries
        """
        try:
            now = datetime.now(timezone.utc)
            time_min = now.isoformat()
            time_max = (now + timedelta(days=days)).isoformat()

            events_result = self.service.events().list(
                calendarId=calendar_id,
                timeMin=time_min,
                timeMax=time_max,
                maxResults=max_results,
                singleEvents=True,
                orderBy='startTime'
            ).execute()

            events = events_result.get('items', [])

            # Simplify event data
            simplified = []
            for event in events:
                start = event['start'].get('dateTime', event['start'].get('date'))
                end = event['end'].get('dateTime', event['end'].get('date'))

                simplified.append({
                    'id': event.get('id'),
                    'summary': event.get('summary', 'No title'),
                    'start': start,
                    'end': end,
                    'location': event.get('location', ''),
                    'description': event.get('description', ''),
                    'hangout_link': event.get('hangoutLink', ''),
                    'html_link': event.get('htmlLink', ''),
                })

            return simplified

        except HttpError as error:
            print(f'An error occurred: {error}')
            return []

    def get_event(self, event_id, calendar_id='primary'):
        """Get a specific event by ID"""
        try:
            event = self.service.events().get(
                calendarId=calendar_id,
                eventId=event_id
            ).execute()
            return event
        except HttpError as error:
            print(f'An error occurred: {error}')
            return None

    def create_event(self, summary, start, end, description='', location='',
                     attendees=None, calendar_id='primary', timezone_str='America/New_York'):
        """
        Create a new calendar event

        Args:
            summary: Event title
            start: Start datetime (ISO format string)
            end: End datetime (ISO format string)
            description: Event description (optional)
            location: Event location (optional)
            attendees: List of email addresses (optional)
            calendar_id: Calendar ID (default: 'primary')
            timezone_str: Timezone (default: 'America/New_York')

        Returns:
            Created event object
        """
        try:
            event = {
                'summary': summary,
                'location': location,
                'description': description,
                'start': {
                    'dateTime': start,
                    'timeZone': timezone_str,
                },
                'end': {
                    'dateTime': end,
                    'timeZone': timezone_str,
                },
            }

            if attendees:
                event['attendees'] = [{'email': email} for email in attendees]

            created_event = self.service.events().insert(
                calendarId=calendar_id,
                body=event
            ).execute()

            print(f"✅ Event created: {created_event.get('htmlLink')}")
            return created_event

        except HttpError as error:
            print(f'An error occurred: {error}')
            return None

    def quick_add(self, text, calendar_id='primary'):
        """
        Create an event using natural language

        Args:
            text: Natural language event description
                  e.g., "Meeting with John tomorrow at 3pm"
            calendar_id: Calendar ID (default: 'primary')

        Returns:
            Created event object
        """
        try:
            event = self.service.events().quickAdd(
                calendarId=calendar_id,
                text=text
            ).execute()

            print(f"✅ Event created: {event.get('summary')}")
            return event

        except HttpError as error:
            print(f'An error occurred: {error}')
            return None

    def delete_event(self, event_id, calendar_id='primary'):
        """Delete a calendar event"""
        try:
            self.service.events().delete(
                calendarId=calendar_id,
                eventId=event_id
            ).execute()
            print(f"✅ Event deleted: {event_id}")
            return True
        except HttpError as error:
            print(f'An error occurred: {error}')
            return False

    def update_event(self, event_id, updates, calendar_id='primary'):
        """
        Update an existing event

        Args:
            event_id: Event ID to update
            updates: Dictionary of fields to update
            calendar_id: Calendar ID (default: 'primary')

        Returns:
            Updated event object
        """
        try:
            event = self.service.events().get(
                calendarId=calendar_id,
                eventId=event_id
            ).execute()

            for key, value in updates.items():
                if key in ['start', 'end']:
                    if isinstance(value, str):
                        event[key] = {'dateTime': value, 'timeZone': 'America/New_York'}
                else:
                    event[key] = value

            updated_event = self.service.events().update(
                calendarId=calendar_id,
                eventId=event_id,
                body=event
            ).execute()

            print(f"✅ Event updated: {updated_event.get('summary')}")
            return updated_event

        except HttpError as error:
            print(f'An error occurred: {error}')
            return None

    def list_calendars(self):
        """List all calendars accessible to the user"""
        try:
            calendars_result = self.service.calendarList().list().execute()
            calendars = calendars_result.get('items', [])

            simplified = []
            for cal in calendars:
                simplified.append({
                    'id': cal.get('id'),
                    'summary': cal.get('summary'),
                    'primary': cal.get('primary', False),
                    'access_role': cal.get('accessRole'),
                })

            return simplified

        except HttpError as error:
            print(f'An error occurred: {error}')
            return []
