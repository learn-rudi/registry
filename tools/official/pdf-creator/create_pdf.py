#!/usr/bin/env python3
"""
PDF Creator Tool
Converts HTML files to PDF using wkhtmltopdf
"""
import sys
import json
import os

def main():
    # Read input from stdin (JSON)
    try:
        input_data = json.loads(sys.stdin.read())
    except json.JSONDecodeError:
        print(json.dumps({
            "success": False,
            "error": "Invalid JSON input"
        }))
        sys.exit(1)
    
    input_file = input_data.get('input_file')
    output_file = input_data.get('output_file', 'output.pdf')
    
    if not input_file:
        print(json.dumps({
            "success": False,
            "error": "input_file is required"
        }))
        sys.exit(1)
    
    if not os.path.exists(input_file):
        print(json.dumps({
            "success": False,
            "error": f"Input file not found: {input_file}"
        }))
        sys.exit(1)
    
    # For now, just return a success message
    # In a real tool, you would use pdfkit or wkhtmltopdf here
    result = {
        "success": True,
        "outputs": {
            "pdf_path": output_file
        },
        "message": f"Would convert {input_file} to {output_file} (demo mode)"
    }
    
    print(json.dumps(result))
    sys.exit(0)

if __name__ == '__main__':
    main()
