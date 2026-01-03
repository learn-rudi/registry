import os
from pathlib import Path
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

class GoogleAuth:
    def __init__(self, credentials_file='credentials.json', token_file='token.json', scopes=None):
        self.credentials_file = credentials_file
        self.token_file = token_file
        self.scopes = scopes or [
            'https://www.googleapis.com/auth/drive',
            'https://www.googleapis.com/auth/documents',
            'https://www.googleapis.com/auth/spreadsheets',
            'https://www.googleapis.com/auth/presentations',
            'https://www.googleapis.com/auth/gmail.modify',  # Read, send, and modify emails
            'https://www.googleapis.com/auth/calendar'  # Calendar read/write access
        ]
        self.creds = None

    def authenticate(self):
        if os.path.exists(self.token_file):
            self.creds = Credentials.from_authorized_user_file(self.token_file, self.scopes)

        if not self.creds or not self.creds.valid:
            if self.creds and self.creds.expired and self.creds.refresh_token:
                self.creds.refresh(Request())
            else:
                flow = InstalledAppFlow.from_client_secrets_file(
                    self.credentials_file, self.scopes)
                self.creds = flow.run_local_server(port=0)

            with open(self.token_file, 'w') as token:
                token.write(self.creds.to_json())

        return self.creds

    def get_service(self, service_name, version):
        if not self.creds:
            self.authenticate()

        try:
            service = build(service_name, version, credentials=self.creds)
            return service
        except HttpError as error:
            print(f'An error occurred: {error}')
            return None