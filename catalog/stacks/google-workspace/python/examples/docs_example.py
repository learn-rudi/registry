import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from modules import GoogleAuth, DocsAPI

def main():
    auth = GoogleAuth()
    auth.authenticate()

    docs = DocsAPI(auth)

    document_id = docs.create_document('My Test Document')
    print(f'Created document: {document_id}')

    docs.insert_text(document_id, 'Hello, World!\n\nThis is a test document.\n', 1)
    print('Text inserted')

    docs.apply_formatting(document_id, 1, 14, bold=True, font_size=24)
    print('Formatting applied to title')

    content = docs.read_content(document_id)
    print('Document content:', content)

if __name__ == '__main__':
    main()