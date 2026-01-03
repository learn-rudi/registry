import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from modules import GoogleAuth, SheetsAPI, DocsAPI, SlidesAPI, DriveAPI

def main():
    auth = GoogleAuth()
    auth.authenticate()

    drive = DriveAPI(auth)
    sheets = SheetsAPI(auth)
    docs = DocsAPI(auth)
    slides = SlidesAPI(auth)

    folder_id = drive.create_folder('My Workspace Project')
    print(f'Created project folder: {folder_id}')

    spreadsheet_id = sheets.create_spreadsheet('Project Data')
    print(f'Created spreadsheet: {spreadsheet_id}')

    document_id = docs.create_document('Project Notes')
    print(f'Created document: {document_id}')

    presentation_id = slides.create_presentation('Project Presentation')
    print(f'Created presentation: {presentation_id}')

    print('\nAll files created successfully!')

if __name__ == '__main__':
    main()