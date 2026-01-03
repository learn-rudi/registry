import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from modules import GoogleAuth, SlidesAPI

def main():
    auth = GoogleAuth()
    auth.authenticate()

    slides = SlidesAPI(auth)

    presentation_id = slides.create_presentation('My Test Presentation')
    print(f'Created presentation: {presentation_id}')

    presentation = slides.get_presentation(presentation_id)
    first_slide_id = presentation['slides'][0]['objectId']

    slides.add_text_box(
        presentation_id,
        first_slide_id,
        'Welcome to My Presentation',
        x=50,
        y=50,
        width=600,
        height=100
    )
    print('Text box added to first slide')

    slide_response = slides.create_slide(presentation_id, layout='TITLE_AND_BODY')
    print('New slide created')

if __name__ == '__main__':
    main()