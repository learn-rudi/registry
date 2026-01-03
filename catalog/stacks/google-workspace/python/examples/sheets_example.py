import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from modules import GoogleAuth, SheetsAPI

def main():
    auth = GoogleAuth()
    auth.authenticate()

    sheets = SheetsAPI(auth)

    spreadsheet_id = sheets.create_spreadsheet('My Test Spreadsheet')
    print(f'Created spreadsheet: {spreadsheet_id}')

    values = [
        ['Name', 'Age', 'City'],
        ['Alice', '30', 'New York'],
        ['Bob', '25', 'San Francisco'],
        ['Charlie', '35', 'Seattle']
    ]

    sheets.update_values(spreadsheet_id, 'Sheet1!A1', values)
    print('Data written to spreadsheet')

    result = sheets.get_values(spreadsheet_id, 'Sheet1!A1:C4')
    print('Retrieved values:', result)

if __name__ == '__main__':
    main()