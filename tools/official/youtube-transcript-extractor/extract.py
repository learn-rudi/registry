#!/usr/bin/env python3
"""
YouTube Extractor Wrapper
Bridges the Node.js YouTube extractor with the Python Content Hub
"""

import subprocess
import json
import tempfile
from pathlib import Path
from typing import Dict, Any
from urllib.parse import urlparse, parse_qs

def extract_youtube(url: str) -> Dict[str, Any]:
    """
    Extract content from YouTube video
    Uses the existing Node.js YouTube extractor via subprocess
    
    Args:
        url: YouTube video URL
        
    Returns:
        Dictionary with extracted content and metadata
    """
    try:
        # Validate YouTube URL
        parsed = urlparse(url)
        if 'youtube.com' not in parsed.netloc and 'youtu.be' not in parsed.netloc:
            return {
                'success': False,
                'error': 'Invalid YouTube URL'
            }
        
        # Path to Node.js YouTube extractor - try multiple locations
        extractor_path = Path(__file__).parent / 'youtube-extractor.js'
        
        # Check if extractor exists locally
        if not extractor_path.exists():
            # Try the original location with correct filename
            extractor_path = Path('/Users/hoff/My Drive/tools/url-extract/youtube-extractor/youtube-extractor.js')
        
        if not extractor_path.exists():
            return {
                'success': False,
                'error': f'YouTube extractor not found at {extractor_path}. Please ensure the Node.js YouTube extractor is available.'
            }
        
        # Create a temporary file for output
        with tempfile.NamedTemporaryFile(mode='w+', suffix='.txt', delete=False) as tmp_file:
            tmp_path = tmp_file.name
        
        try:
            # Run the Node.js extractor with output file
            result = subprocess.run(
                ['node', str(extractor_path), url, tmp_path],
                capture_output=True,
                text=True,
                timeout=60
            )
            
            # Read the output file
            with open(tmp_path, 'r') as f:
                content = f.read()
            
            # Parse the content which is in a structured format
            extracted = {
                'success': True,
                'url': url,
                'platform': 'youtube',
                'title': 'YouTube Video',
                'author': 'Unknown',
                'description': '',
                'transcript': '',
                'metadata': {}
            }
            
            # Parse the content format from the extractor
            lines = content.split('\n')
            
            # Extract title from first line if it contains "YouTube Video:"
            if lines and 'YouTube Video:' in lines[0]:
                extracted['title'] = lines[0].replace('YouTube Video:', '').strip()
            
            # Parse structured sections
            current_section = None
            description_lines = []
            transcript_lines = []
            
            for line in lines:
                if line.startswith('Author:'):
                    extracted['author'] = line.replace('Author:', '').strip()
                elif line.startswith('Duration:'):
                    extracted['metadata']['duration'] = line.replace('Duration:', '').strip()
                elif line.startswith('Views:'):
                    extracted['metadata']['views'] = line.replace('Views:', '').strip()
                elif line.strip() == 'Description:':
                    current_section = 'description'
                elif line.strip() == 'Transcript:':
                    current_section = 'transcript'
                elif line.strip() == '---':
                    current_section = None
                elif current_section == 'description':
                    description_lines.append(line)
                elif current_section == 'transcript':
                    transcript_lines.append(line)
            
            # Clean up content
            extracted['description'] = '\n'.join(description_lines).strip()
            extracted['transcript'] = '\n'.join(transcript_lines).strip()
            
            # Remove temporary file
            Path(tmp_path).unlink(missing_ok=True)
            
        except subprocess.TimeoutExpired:
            Path(tmp_path).unlink(missing_ok=True)
            return {
                'success': False,
                'error': 'YouTube extraction timed out'
            }
        except Exception as e:
            Path(tmp_path).unlink(missing_ok=True)
            raise e
        
        # Combine transcript and description for content field
        extracted['content'] = extracted['transcript'] if extracted['transcript'] else extracted['description']
        
        # Extract video ID for thumbnail
        video_id = None
        if 'v=' in url:
            video_id = parse_qs(urlparse(url).query).get('v', [None])[0]
        elif 'youtu.be' in url:
            video_id = urlparse(url).path.lstrip('/')
        
        if video_id:
            extracted['metadata']['video_id'] = video_id
            extracted['metadata']['thumbnail'] = f'https://img.youtube.com/vi/{video_id}/maxresdefault.jpg'
        
        return extracted
        
    except subprocess.TimeoutExpired:
        return {
            'success': False,
            'error': 'YouTube extraction timed out'
        }
    except Exception as e:
        return {
            'success': False,
            'error': str(e)
        }

def extract_youtube_batch(urls: list) -> list:
    """Extract multiple YouTube videos"""
    results = []
    for url in urls:
        result = extract_youtube(url)
        results.append(result)
    return results

# For testing
if __name__ == '__main__':
    import sys
    if len(sys.argv) > 1:
        test_url = sys.argv[1]
        result = extract_youtube(test_url)
        print(json.dumps(result, indent=2))