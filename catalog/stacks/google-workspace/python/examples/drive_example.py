import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from modules import GoogleAuth, DriveAPI

def main():
    auth = GoogleAuth()
    auth.authenticate()

    drive = DriveAPI(auth)

    files = drive.list_files(page_size=5)
    print('Recent files:')
    for file in files:
        print(f"  {file['name']} ({file['id']})")

    folder_id = drive.create_folder('Test Folder')
    print(f'Created folder: {folder_id}')

    results = drive.list_files(
        query=f"'{folder_id}' in parents",
        page_size=10
    )
    print(f'Files in folder: {len(results)}')

if __name__ == '__main__':
    main()