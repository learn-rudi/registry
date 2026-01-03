"""
Newsletter Pipeline

Flow: Pull Data → AI Analyzes → Generate Image → Draft Email
"""

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from lib import Pipeline, Step, anthropic, google_ai, google_workspace


async def pull_data(spreadsheet_id: str, range: str) -> dict:
    """Pull data from Google Sheets"""
    result = await google_workspace.read_sheet(spreadsheet_id, range)
    return {"data": result.get("data", [])}


async def analyze_data(data: list, context: str = "") -> dict:
    """Use Claude to analyze data and generate insights"""
    data_str = "\n".join([str(row) for row in data[:50]])  # Limit for context

    result = await anthropic.ask_sonnet(
        f"""Analyze this data and provide key insights for a newsletter:

Context: {context}

Data:
{data_str}

Provide:
1. Key trends or patterns
2. Notable highlights
3. Actionable insights
4. A brief summary paragraph suitable for an email newsletter"""
    )
    return {"analysis": result["text"], "cost": result.get("cost", 0)}


async def write_newsletter(analysis: str, topic: str) -> dict:
    """Write newsletter content"""
    result = await anthropic.ask_sonnet(
        f"""Write a professional newsletter email about "{topic}" based on this analysis:

{analysis}

Format:
- Engaging subject line
- Brief intro
- 3-4 key points with headers
- Call to action
- Professional sign-off

Keep it concise and scannable."""
    )
    return {"newsletter": result["text"], "cost": result.get("cost", 0)}


async def generate_header_image(topic: str) -> dict:
    """Generate newsletter header image"""
    result = await google_ai.generate_image(
        prompt=f"Professional email newsletter header banner: {topic}. Clean, modern design with subtle colors.",
        model="nano-banana",
        aspect="16:9",
    )
    return {"image": result}


async def create_draft(to: str, subject: str, body: str) -> dict:
    """Create email draft in Gmail"""
    # Extract subject from content if it contains one
    lines = body.strip().split("\n")
    if lines[0].lower().startswith("subject:"):
        subject = lines[0].replace("Subject:", "").replace("subject:", "").strip()
        body = "\n".join(lines[1:]).strip()

    result = await google_workspace.create_draft(to, subject, body)
    return {"draft_id": result.get("draft_id")}


def create_newsletter_pipeline(
    topic: str,
    spreadsheet_id: str = None,
    sheet_range: str = "Sheet1!A1:Z100",
    recipient: str = None,
) -> Pipeline:
    """Create a newsletter pipeline"""
    pipeline = Pipeline(
        name="newsletter",
        description=f"Generate newsletter about: {topic}"
    )

    # If we have a spreadsheet, pull data first
    if spreadsheet_id:
        pipeline.add_step(Step(
            name="pull_data",
            action=pull_data,
            inputs={"spreadsheet_id": spreadsheet_id, "range": sheet_range},
        ))

        pipeline.add_step(Step(
            name="analyze",
            action=analyze_data,
            inputs={"data": "$pull_data.data", "context": topic},
        ))
    else:
        # Just research the topic
        async def research(topic):
            result = await anthropic.ask_sonnet(f"Research recent news and updates about: {topic}")
            return {"analysis": result["text"], "cost": result.get("cost", 0)}

        pipeline.add_step(Step(
            name="analyze",
            action=research,
            inputs={"topic": topic},
        ))

    pipeline.add_step(Step(
        name="write",
        action=write_newsletter,
        inputs={"analysis": "$analyze.analysis", "topic": topic},
    ))

    pipeline.add_step(Step(
        name="image",
        action=generate_header_image,
        inputs={"topic": topic},
    ))

    if recipient:
        pipeline.add_step(Step(
            name="draft",
            action=create_draft,
            inputs={
                "to": recipient,
                "subject": f"Newsletter: {topic}",
                "body": "$write.newsletter",
            },
        ))

    return pipeline


async def main():
    """Run the newsletter pipeline"""
    import argparse

    parser = argparse.ArgumentParser(description="Newsletter Pipeline")
    parser.add_argument("topic", help="Newsletter topic")
    parser.add_argument("--spreadsheet", help="Google Sheets ID for data")
    parser.add_argument("--range", default="Sheet1!A1:Z100", help="Sheet range")
    parser.add_argument("--to", help="Recipient email (creates draft)")
    args = parser.parse_args()

    print(f"\n📧 Starting Newsletter Pipeline")
    print(f"   Topic: {args.topic}")
    if args.spreadsheet:
        print(f"   Data Source: {args.spreadsheet}")
    if args.to:
        print(f"   Recipient: {args.to}")
    print()

    pipeline = create_newsletter_pipeline(
        topic=args.topic,
        spreadsheet_id=args.spreadsheet,
        sheet_range=args.range,
        recipient=args.to,
    )

    results = await pipeline.run()

    print(f"\n✅ Pipeline Complete!")

    if "draft" in results:
        print(f"   Draft ID: {results['draft'].get('draft_id')}")

    if "write" in results:
        print(f"\n--- Newsletter Preview ---")
        print(results["write"].get("newsletter", "")[:500] + "...")

    # Show costs
    total_cost = 0
    for step_name, step_result in results.items():
        if isinstance(step_result, dict):
            total_cost += step_result.get("cost", 0)
    print(f"\n   Total AI Cost: ${total_cost:.4f}")


if __name__ == "__main__":
    asyncio.run(main())
