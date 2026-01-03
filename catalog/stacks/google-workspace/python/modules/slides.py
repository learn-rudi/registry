from googleapiclient.errors import HttpError
from .auth import GoogleAuth

class SlidesAPI:
    def __init__(self, auth: GoogleAuth):
        self.auth = auth
        self.service = auth.get_service('slides', 'v1')

    def create_presentation(self, title):
        try:
            presentation = {
                'title': title
            }
            presentation = self.service.presentations().create(
                body=presentation
            ).execute()
            return presentation.get('presentationId')
        except HttpError as error:
            print(f'An error occurred: {error}')
            return None

    def get_presentation(self, presentation_id):
        try:
            presentation = self.service.presentations().get(
                presentationId=presentation_id
            ).execute()
            return presentation
        except HttpError as error:
            print(f'An error occurred: {error}')
            return None

    def create_slide(self, presentation_id, page_id=None, layout='BLANK'):
        try:
            requests = [{
                'createSlide': {
                    'objectId': page_id,
                    'slideLayoutReference': {
                        'predefinedLayout': layout
                    }
                }
            }]
            body = {
                'requests': requests
            }
            response = self.service.presentations().batchUpdate(
                presentationId=presentation_id,
                body=body
            ).execute()
            return response
        except HttpError as error:
            print(f'An error occurred: {error}')
            return None

    def add_text_box(self, presentation_id, page_id, text, x=100, y=100, width=300, height=50):
        try:
            element_id = f'TextBox_{page_id}'
            requests = [
                {
                    'createShape': {
                        'objectId': element_id,
                        'shapeType': 'TEXT_BOX',
                        'elementProperties': {
                            'pageObjectId': page_id,
                            'size': {
                                'height': {'magnitude': height, 'unit': 'PT'},
                                'width': {'magnitude': width, 'unit': 'PT'}
                            },
                            'transform': {
                                'scaleX': 1,
                                'scaleY': 1,
                                'translateX': x,
                                'translateY': y,
                                'unit': 'PT'
                            }
                        }
                    }
                },
                {
                    'insertText': {
                        'objectId': element_id,
                        'text': text,
                        'insertionIndex': 0
                    }
                }
            ]
            body = {
                'requests': requests
            }
            response = self.service.presentations().batchUpdate(
                presentationId=presentation_id,
                body=body
            ).execute()
            return response
        except HttpError as error:
            print(f'An error occurred: {error}')
            return None

    def batch_update(self, presentation_id, requests):
        try:
            body = {
                'requests': requests
            }
            response = self.service.presentations().batchUpdate(
                presentationId=presentation_id,
                body=body
            ).execute()
            return response
        except HttpError as error:
            print(f'An error occurred: {error}')
            return None

    def replace_text(self, presentation_id, find_text, replace_text):
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
            return self.batch_update(presentation_id, requests)
        except HttpError as error:
            print(f'An error occurred: {error}')
            return None

    def add_image(self, presentation_id, page_id, image_url, x=100, y=100, width=400, height=300):
        try:
            element_id = f'Image_{page_id}'
            requests = [{
                'createImage': {
                    'objectId': element_id,
                    'url': image_url,
                    'elementProperties': {
                        'pageObjectId': page_id,
                        'size': {
                            'height': {'magnitude': height, 'unit': 'PT'},
                            'width': {'magnitude': width, 'unit': 'PT'}
                        },
                        'transform': {
                            'scaleX': 1,
                            'scaleY': 1,
                            'translateX': x,
                            'translateY': y,
                            'unit': 'PT'
                        }
                    }
                }
            }]
            return self.batch_update(presentation_id, requests)
        except HttpError as error:
            print(f'An error occurred: {error}')
            return None