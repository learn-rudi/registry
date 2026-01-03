"""
Pipeline Orchestrator

Chain multiple stacks together into workflows.
"""

import asyncio
from dataclasses import dataclass, field
from typing import Any, Callable, Awaitable
from datetime import datetime


@dataclass
class Step:
    """A single step in a pipeline"""
    name: str
    action: Callable[..., Awaitable[Any]]
    inputs: dict = field(default_factory=dict)
    outputs: list[str] = field(default_factory=list)

    async def run(self, context: dict) -> dict:
        """Execute step with context, return outputs"""
        # Resolve inputs from context
        resolved_inputs = {}
        for key, value in self.inputs.items():
            if isinstance(value, str) and value.startswith("$"):
                # Reference to previous output: $step_name.output_key
                ref = value[1:]
                if "." in ref:
                    step_name, output_key = ref.split(".", 1)
                    resolved_inputs[key] = context.get(step_name, {}).get(output_key)
                else:
                    resolved_inputs[key] = context.get(ref)
            else:
                resolved_inputs[key] = value

        # Run the action
        result = await self.action(**resolved_inputs)

        return result


@dataclass
class Pipeline:
    """A sequence of steps that process data through multiple stacks"""
    name: str
    description: str = ""
    steps: list[Step] = field(default_factory=list)

    def add_step(self, step: Step) -> "Pipeline":
        """Add a step to the pipeline"""
        self.steps.append(step)
        return self

    async def run(self, initial_context: dict = None) -> dict:
        """Execute all steps in sequence"""
        context = initial_context or {}
        context["_pipeline"] = self.name
        context["_started"] = datetime.now().isoformat()

        results = {}

        for i, step in enumerate(self.steps):
            print(f"[{i+1}/{len(self.steps)}] Running: {step.name}")
            try:
                result = await step.run(context)
                results[step.name] = result
                context[step.name] = result
                print(f"    ✓ {step.name} complete")
            except Exception as e:
                print(f"    ✗ {step.name} failed: {e}")
                results[step.name] = {"error": str(e)}
                context["_error"] = str(e)
                break

        context["_completed"] = datetime.now().isoformat()
        results["_context"] = context

        return results


async def run_pipeline(pipeline: Pipeline, context: dict = None) -> dict:
    """Convenience function to run a pipeline"""
    return await pipeline.run(context)


# Pipeline builder helpers
def create_pipeline(name: str, description: str = "") -> Pipeline:
    """Create a new pipeline"""
    return Pipeline(name=name, description=description)


def step(name: str, action: Callable, inputs: dict = None, outputs: list = None) -> Step:
    """Create a pipeline step"""
    return Step(
        name=name,
        action=action,
        inputs=inputs or {},
        outputs=outputs or [],
    )
