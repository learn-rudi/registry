---
name: pdf-creator
description: Convert HTML files to PDF documents
---

# PDF Creator

Convert HTML files into professional PDF documents. Perfect for generating reports, invoices, documentation, and printable versions of web content.

## Features

- Convert any HTML file to PDF
- Preserves CSS styling and layout
- Supports custom output filenames
- Uses pdfkit and wkhtmltopdf under the hood

## Usage

### Basic Conversion

```bash
spacely run pdf-creator --input report.html
```

This creates `output.pdf` in the current directory.

### Custom Output Name

```bash
spacely run pdf-creator --input invoice.html --output invoice-2024.pdf
```

## Input Requirements

**Required:**
- `input_file`: Path to HTML file to convert

**Optional:**
- `output_file`: Name for generated PDF (default: `output.pdf`)

## Common Use Cases

- Converting HTML reports to PDF
- Creating printable invoices
- Generating documentation from HTML
- Archiving web pages as PDFs
- Creating PDF versions of HTML artifacts

## Dependencies

Requires Python packages: `pdfkit`, `jinja2`
System requirement: `wkhtmltopdf` (usually bundled with Spacely Studio)
