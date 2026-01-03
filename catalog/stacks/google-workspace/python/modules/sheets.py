from googleapiclient.errors import HttpError
from .auth import GoogleAuth

class SheetsAPI:
    def __init__(self, auth: GoogleAuth):
        self.auth = auth
        self.service = auth.get_service('sheets', 'v4')

    def create_spreadsheet(self, title):
        try:
            spreadsheet = {
                'properties': {
                    'title': title
                }
            }
            spreadsheet = self.service.spreadsheets().create(
                body=spreadsheet,
                fields='spreadsheetId'
            ).execute()
            return spreadsheet.get('spreadsheetId')
        except HttpError as error:
            print(f'An error occurred: {error}')
            return None

    def get_values(self, spreadsheet_id, range_name):
        try:
            result = self.service.spreadsheets().values().get(
                spreadsheetId=spreadsheet_id,
                range=range_name
            ).execute()
            return result.get('values', [])
        except HttpError as error:
            print(f'An error occurred: {error}')
            return None

    def update_values(self, spreadsheet_id, range_name, values, value_input_option='RAW'):
        try:
            body = {
                'values': values
            }
            result = self.service.spreadsheets().values().update(
                spreadsheetId=spreadsheet_id,
                range=range_name,
                valueInputOption=value_input_option,
                body=body
            ).execute()
            return result.get('updatedCells')
        except HttpError as error:
            print(f'An error occurred: {error}')
            return None

    def append_values(self, spreadsheet_id, range_name, values, value_input_option='RAW'):
        try:
            body = {
                'values': values
            }
            result = self.service.spreadsheets().values().append(
                spreadsheetId=spreadsheet_id,
                range=range_name,
                valueInputOption=value_input_option,
                body=body
            ).execute()
            return result.get('updates')
        except HttpError as error:
            print(f'An error occurred: {error}')
            return None

    def batch_update(self, spreadsheet_id, requests):
        try:
            body = {
                'requests': requests
            }
            result = self.service.spreadsheets().batchUpdate(
                spreadsheetId=spreadsheet_id,
                body=body
            ).execute()
            return result
        except HttpError as error:
            print(f'An error occurred: {error}')
            return None

    def create_sheet(self, spreadsheet_id, sheet_title):
        try:
            requests = [{
                'addSheet': {
                    'properties': {
                        'title': sheet_title
                    }
                }
            }]
            return self.batch_update(spreadsheet_id, requests)
        except HttpError as error:
            print(f'An error occurred: {error}')
            return None