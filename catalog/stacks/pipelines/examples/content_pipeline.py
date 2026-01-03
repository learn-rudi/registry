"""
Content Creation Pipeline

Flow: Research → Write → Generate Image → Save to Drive
"""

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from lib import Pipeline, Step, anthropic, google_ai, google_workspace


async def research_topic(topic: str) -> dict:
    """Use Claude to research a topic"""
    result = await anthropic.ask_sonnet(
        f"Research this topic and provide key points, statistics, and insights: {topic}"
    )
    return {"research": result["text"], "cost": result.get("cost", 0)}


async def write_content(topic: str, research: str, content_type: str = "blog post") -> dict:
    """Use Claude to write content based on research"""
    result = await anthropic.ask_sonnet(
        f"""Based on this research, write a compelling {content_type} about "{topic}".

Research:
{research}

Write in a professional but engaging tone. Include a title and clear sections."""
    )
    return {"content": result["text"], "cost": result.get("cost", 0)}


async def generate_hero_image(topic: str) -> dict:
    """Generate hero image with Google AI"""
    result = await google_ai.generate_image(
        prompt=f"Professional hero banner image for: {topic}. Modern, clean design.",
        model="nano-banana-pro",
        aspect="16:9",
    )
    return {"image_result": result}


async def save_to_docs(title: str, content: str) -> dict:
    """Save content to Google Docs"""
    result = await google_workspace.create_doc(title, content)
    return {"doc_id": result.get("doc_id")}


def create_content_pipeline(topic: str, content_type: str = "blog post") -> Pipeline:
    """Create a content creation pipeline"""
    pipeline = Pipeline(
        name="content_creation",
        description=f"Create {content_type} about: {topic}"
    )

    pipeline.add_step(Step(
        name="research",
        action=research_topic,
        inputs={"topic": topic},
    ))

    pipeline.add_step(Step(
        name="write",
        action=write_content,
        inputs={
            "topic": topic,
            "research": "$research.research",
            "content_type": content_type,
        },
    ))

    pipeline.add_step(Step(
        name="image",
        action=generate_hero_image,
        inputs={"topic": topic},
    ))

    pipeline.add_step(Step(
        name="save",
        action=save_to_docs,
        inputs={
            "title": f"{content_type.title()}: {topic}",
            "content": "$write.content",
        },
    ))

    return pipeline


async def main():
    """Run the content pipeline"""
    import argparse

    parser = argparse.ArgumentParser(description="Content Creation Pipeline")
    parser.add_argument("topic", help="Topic to create content about")
    parser.add_argument("--type", default="blog post", help="Content type (blog post, article, etc.)")
    args = parser.parse_args()

    print(f"\n🚀 Starting Content Pipeline")
    print(f"   Topic: {args.topic}")
    print(f"   Type: {args.type}\n")

    pipeline = create_content_pipeline(args.topic, args.type)
    results = await pipeline.run()

    print(f"\n✅ Pipeline Complete!")
    if "save" in results:
        print(f"   Doc ID: {results['save'].get('doc_id')}")

    # Show costs
    total_cost = 0
    for step_name, step_result in results.items():
        if isinstance(step_result, dict) and "cost" in step_result:
            total_cost += step_result["cost"]
    print(f"   Total AI Cost: ${total_cost:.4f}")


if __name__ == "__main__":
    asyncio.run(main())
