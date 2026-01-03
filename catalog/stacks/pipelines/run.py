#!/usr/bin/env python3
"""
Pipeline Runner CLI

Run pipelines from the command line.
"""

import asyncio
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from examples.content_pipeline import create_content_pipeline
from examples.newsletter_pipeline import create_newsletter_pipeline


PIPELINES = {
    "content": {
        "description": "Create content (research → write → image → save)",
        "args": ["topic"],
        "optional": ["--type"],
    },
    "newsletter": {
        "description": "Create newsletter (data → analyze → write → draft)",
        "args": ["topic"],
        "optional": ["--spreadsheet", "--range", "--to"],
    },
}


def list_pipelines():
    """List available pipelines"""
    print("\n📋 Available Pipelines:\n")
    for name, info in PIPELINES.items():
        print(f"  {name}")
        print(f"    {info['description']}")
        print(f"    Args: {', '.join(info['args'])}")
        if info.get("optional"):
            print(f"    Optional: {', '.join(info['optional'])}")
        print()


async def run_content(args):
    """Run content pipeline"""
    pipeline = create_content_pipeline(args.topic, args.type)
    return await pipeline.run()


async def run_newsletter(args):
    """Run newsletter pipeline"""
    pipeline = create_newsletter_pipeline(
        topic=args.topic,
        spreadsheet_id=args.spreadsheet,
        sheet_range=args.range,
        recipient=args.to,
    )
    return await pipeline.run()


async def main():
    parser = argparse.ArgumentParser(
        description="Pipeline Runner - Chain AI stacks together",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python run.py content "AI in Healthcare"
  python run.py content "Startup Tips" --type "article"
  python run.py newsletter "Weekly Update" --to "team@example.com"
  python run.py newsletter "Sales Report" --spreadsheet "abc123" --to "sales@example.com"
  python run.py --list
        """,
    )

    parser.add_argument("--list", action="store_true", help="List available pipelines")

    subparsers = parser.add_subparsers(dest="pipeline", help="Pipeline to run")

    # Content pipeline
    content_parser = subparsers.add_parser("content", help="Content creation pipeline")
    content_parser.add_argument("topic", help="Topic to create content about")
    content_parser.add_argument("--type", default="blog post", help="Content type")

    # Newsletter pipeline
    newsletter_parser = subparsers.add_parser("newsletter", help="Newsletter pipeline")
    newsletter_parser.add_argument("topic", help="Newsletter topic")
    newsletter_parser.add_argument("--spreadsheet", help="Google Sheets ID for data")
    newsletter_parser.add_argument("--range", default="Sheet1!A1:Z100", help="Sheet range")
    newsletter_parser.add_argument("--to", help="Recipient email")

    args = parser.parse_args()

    if args.list:
        list_pipelines()
        return

    if not args.pipeline:
        parser.print_help()
        print("\n💡 Use --list to see available pipelines")
        return

    print(f"\n🚀 Running Pipeline: {args.pipeline}\n")

    if args.pipeline == "content":
        results = await run_content(args)
    elif args.pipeline == "newsletter":
        results = await run_newsletter(args)
    else:
        print(f"Unknown pipeline: {args.pipeline}")
        return

    # Summary
    print(f"\n{'='*50}")
    print("📊 Pipeline Results")
    print('='*50)

    total_cost = 0
    for step_name, step_result in results.items():
        if step_name.startswith("_"):
            continue
        if isinstance(step_result, dict):
            status = "✗ Error" if "error" in step_result else "✓ Success"
            print(f"  {step_name}: {status}")
            if "cost" in step_result:
                total_cost += step_result["cost"]

    print(f"\n  Total AI Cost: ${total_cost:.4f}")
    print()


if __name__ == "__main__":
    asyncio.run(main())
