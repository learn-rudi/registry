from googleapiclient.errors import HttpError
from .auth import GoogleAuth

class DocsAPI:
    def __init__(self, auth: GoogleAuth):
        self.auth = auth
        self.service = auth.get_service('docs', 'v1')

    def create_document(self, title):
        try:
            document = {
                'title': title
            }
            doc = self.service.documents().create(body=document).execute()
            return doc.get('documentId')
        except HttpError as error:
            print(f'An error occurred: {error}')
            return None

    def get_document(self, document_id):
        try:
            document = self.service.documents().get(documentId=document_id).execute()
            return document
        except HttpError as error:
            print(f'An error occurred: {error}')
            return None

    def read_content(self, document_id):
        try:
            document = self.get_document(document_id)
            if not document:
                return None

            content = []
            for element in document.get('body', {}).get('content', []):
                if 'paragraph' in element:
                    for text_run in element['paragraph'].get('elements', []):
                        if 'textRun' in text_run:
                            content.append(text_run['textRun'].get('content', ''))
            return ''.join(content)
        except HttpError as error:
            print(f'An error occurred: {error}')
            return None

    def insert_text(self, document_id, text, index=1):
        try:
            requests = [{
                'insertText': {
                    'location': {
                        'index': index
                    },
                    'text': text
                }
            }]
            result = self.service.documents().batchUpdate(
                documentId=document_id,
                body={'requests': requests}
            ).execute()
            return result
        except HttpError as error:
            print(f'An error occurred: {error}')
            return None

    def batch_update(self, document_id, requests):
        try:
            result = self.service.documents().batchUpdate(
                documentId=document_id,
                body={'requests': requests}
            ).execute()
            return result
        except HttpError as error:
            print(f'An error occurred: {error}')
            return None

    def replace_text(self, document_id, find_text, replace_text):
        try:
            requests = [{
                'replaceAllText': {
                    'containsText': {
                        'text': find_text,
                        'matchCase': True
                    },
                    'replaceText': replace_text
                }
            }]
            return self.batch_update(document_id, requests)
        except HttpError as error:
            print(f'An error occurred: {error}')
            return None

    def apply_formatting(self, document_id, start_index, end_index, bold=None, italic=None, font_size=None):
        try:
            text_style = {}
            if bold is not None:
                text_style['bold'] = bold
            if italic is not None:
                text_style['italic'] = italic
            if font_size is not None:
                text_style['fontSize'] = {'magnitude': font_size, 'unit': 'PT'}

            requests = [{
                'updateTextStyle': {
                    'range': {
                        'startIndex': start_index,
                        'endIndex': end_index
                    },
                    'textStyle': text_style,
                    'fields': ','.join(text_style.keys())
                }
            }]
            return self.batch_update(document_id, requests)
        except HttpError as error:
            print(f'An error occurred: {error}')
            return None

    def insert_image(self, document_id, image_url, index=1, width=None, height=None):
        """Insert an image into a document from a URL.

        The image must be publicly accessible or a Google Drive link with proper permissions.
        """
        try:
            request = {
                'insertInlineImage': {
                    'location': {'index': index},
                    'uri': image_url
                }
            }

            # Add optional size constraints
            if width or height:
                request['insertInlineImage']['objectSize'] = {}
                if width:
                    request['insertInlineImage']['objectSize']['width'] = {
                        'magnitude': width,
                        'unit': 'PT'
                    }
                if height:
                    request['insertInlineImage']['objectSize']['height'] = {
                        'magnitude': height,
                        'unit': 'PT'
                    }

            result = self.service.documents().batchUpdate(
                documentId=document_id,
                body={'requests': [request]}
            ).execute()
            return result
        except HttpError as error:
            print(f'An error occurred: {error}')
            return None