from googleapiclient.errors import HttpError
from googleapiclient.http import MediaFileUpload, MediaIoBaseDownload
from .auth import GoogleAuth
import io

class DriveAPI:
    def __init__(self, auth: GoogleAuth):
        self.auth = auth
        self.service = auth.get_service('drive', 'v3')

    def list_files(self, query=None, folder_id=None, page_size=10, fields='files(id, name, mimeType, createdTime, modifiedTime)'):
        try:
            # Build query with folder_id if provided
            q = query
            if folder_id:
                folder_query = f'"{folder_id}" in parents'
                q = f'{query} and {folder_query}' if query else folder_query

            results = self.service.files().list(
                q=q,
                pageSize=page_size,
                fields=f'nextPageToken, {fields}'
            ).execute()
            return results.get('files', [])
        except HttpError as error:
            print(f'An error occurred: {error}')
            return None

    def create_folder(self, folder_name, parent_id=None):
        try:
            file_metadata = {
                'name': folder_name,
                'mimeType': 'application/vnd.google-apps.folder'
            }
            if parent_id:
                file_metadata['parents'] = [parent_id]

            folder = self.service.files().create(
                body=file_metadata,
                fields='id'
            ).execute()
            return folder.get('id')
        except HttpError as error:
            print(f'An error occurred: {error}')
            return None

    def upload_file(self, file_path, file_name=None, mime_type=None, parent_id=None):
        try:
            file_metadata = {
                'name': file_name or file_path.split('/')[-1]
            }
            if parent_id:
                file_metadata['parents'] = [parent_id]

            media = MediaFileUpload(file_path, mimetype=mime_type, resumable=True)
            file = self.service.files().create(
                body=file_metadata,
                media_body=media,
                fields='id'
            ).execute()
            return file.get('id')
        except HttpError as error:
            print(f'An error occurred: {error}')
            return None

    def download_file(self, file_id, destination_path):
        try:
            request = self.service.files().get_media(fileId=file_id)
            with io.FileIO(destination_path, 'wb') as fh:
                downloader = MediaIoBaseDownload(fh, request)
                done = False
                while not done:
                    status, done = downloader.next_chunk()
            return destination_path
        except HttpError as error:
            print(f'An error occurred: {error}')
            return None

    def export_file(self, file_id, mime_type, destination_path):
        try:
            request = self.service.files().export_media(
                fileId=file_id,
                mimeType=mime_type
            )
            with io.FileIO(destination_path, 'wb') as fh:
                downloader = MediaIoBaseDownload(fh, request)
                done = False
                while not done:
                    status, done = downloader.next_chunk()
            return destination_path
        except HttpError as error:
            print(f'An error occurred: {error}')
            return None

    def delete_file(self, file_id):
        try:
            self.service.files().delete(fileId=file_id).execute()
            return True
        except HttpError as error:
            print(f'An error occurred: {error}')
            return False

    def share_file(self, file_id, email, role='reader', type='user'):
        try:
            permission = {
                'type': type,
                'role': role,
                'emailAddress': email
            }
            self.service.permissions().create(
                fileId=file_id,
                body=permission,
                fields='id'
            ).execute()
            return True
        except HttpError as error:
            print(f'An error occurred: {error}')
            return False

    def get_file_metadata(self, file_id, fields='*'):
        try:
            file = self.service.files().get(
                fileId=file_id,
                fields=fields
            ).execute()
            return file
        except HttpError as error:
            print(f'An error occurred: {error}')
            return None

    def make_public(self, file_id):
        """Make a file publicly viewable and return the direct link."""
        try:
            # Add public permission
            permission = {
                'type': 'anyone',
                'role': 'reader'
            }
            self.service.permissions().create(
                fileId=file_id,
                body=permission
            ).execute()

            # Return the direct viewable URL for images
            return f"https://drive.google.com/uc?id={file_id}"
        except HttpError as error:
            print(f'An error occurred: {error}')
            return None