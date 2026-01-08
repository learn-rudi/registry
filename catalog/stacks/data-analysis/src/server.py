#!/usr/bin/env python3
"""
Data Analysis MCP Server

Analyze data with pandas, numpy, and matplotlib.
Load CSVs, query data, generate charts.
"""

import os
import sys
import json
import base64
import io
from pathlib import Path
from datetime import datetime

# MCP protocol
import asyncio
from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp import types

# Data analysis
import pandas as pd
import numpy as np
import matplotlib
matplotlib.use('Agg')  # Non-interactive backend
import matplotlib.pyplot as plt

# ============================================================================
# CONFIGURATION
# ============================================================================

DEFAULT_OUTPUT_DIR = Path.home() / ".rudi" / "outputs"
MAX_ROWS_DISPLAY = 50  # Max rows to show in text output

# In-memory dataframe storage
_dataframes: dict[str, pd.DataFrame] = {}


def ensure_output_dir():
    """Ensure output directory exists."""
    DEFAULT_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


def expand_path(p: str) -> Path:
    """Expand ~ and make absolute."""
    return Path(p).expanduser().resolve()


def generate_filename(prefix: str, ext: str) -> str:
    """Generate timestamped filename."""
    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    return f"{prefix}-{ts}.{ext}"


def df_to_text(df: pd.DataFrame, max_rows: int = MAX_ROWS_DISPLAY) -> str:
    """Convert dataframe to readable text."""
    if len(df) > max_rows:
        return f"Showing first {max_rows} of {len(df)} rows:\n\n{df.head(max_rows).to_string()}"
    return df.to_string()


# ============================================================================
# DATA LOADING
# ============================================================================

def load_csv(path: str, name: str | None = None, **kwargs) -> dict:
    """Load a CSV file into memory."""
    file_path = expand_path(path)
    if not file_path.exists():
        raise FileNotFoundError(f"File not found: {file_path}")

    df = pd.read_csv(file_path, **kwargs)
    df_name = name or file_path.stem
    _dataframes[df_name] = df

    return {
        "name": df_name,
        "rows": len(df),
        "columns": list(df.columns),
        "dtypes": {col: str(dtype) for col, dtype in df.dtypes.items()},
        "preview": df_to_text(df.head(10)),
    }


def load_excel(path: str, name: str | None = None, sheet: str | int = 0, **kwargs) -> dict:
    """Load an Excel file into memory."""
    file_path = expand_path(path)
    if not file_path.exists():
        raise FileNotFoundError(f"File not found: {file_path}")

    df = pd.read_excel(file_path, sheet_name=sheet, **kwargs)
    df_name = name or file_path.stem
    _dataframes[df_name] = df

    return {
        "name": df_name,
        "rows": len(df),
        "columns": list(df.columns),
        "dtypes": {col: str(dtype) for col, dtype in df.dtypes.items()},
        "preview": df_to_text(df.head(10)),
    }


def load_json(path: str, name: str | None = None) -> dict:
    """Load a JSON file into memory."""
    file_path = expand_path(path)
    if not file_path.exists():
        raise FileNotFoundError(f"File not found: {file_path}")

    df = pd.read_json(file_path)
    df_name = name or file_path.stem
    _dataframes[df_name] = df

    return {
        "name": df_name,
        "rows": len(df),
        "columns": list(df.columns),
        "dtypes": {col: str(dtype) for col, dtype in df.dtypes.items()},
        "preview": df_to_text(df.head(10)),
    }


# ============================================================================
# DATA ANALYSIS
# ============================================================================

def describe_data(name: str) -> dict:
    """Get statistical summary of a dataframe."""
    if name not in _dataframes:
        raise ValueError(f"No dataframe named '{name}'. Load data first.")

    df = _dataframes[name]
    desc = df.describe(include='all').fillna('')

    return {
        "name": name,
        "shape": {"rows": len(df), "columns": len(df.columns)},
        "columns": list(df.columns),
        "dtypes": {col: str(dtype) for col, dtype in df.dtypes.items()},
        "missing": df.isnull().sum().to_dict(),
        "statistics": desc.to_string(),
    }


def query_data(name: str, query: str) -> dict:
    """Query a dataframe using pandas query syntax."""
    if name not in _dataframes:
        raise ValueError(f"No dataframe named '{name}'. Load data first.")

    df = _dataframes[name]
    result = df.query(query)

    return {
        "name": name,
        "query": query,
        "rows_matched": len(result),
        "total_rows": len(df),
        "result": df_to_text(result),
    }


def transform_data(name: str, operations: list[dict], output_name: str | None = None) -> dict:
    """
    Apply transformations to a dataframe.

    Operations can include:
    - {"type": "filter", "query": "column > 5"}
    - {"type": "select", "columns": ["col1", "col2"]}
    - {"type": "rename", "mapping": {"old": "new"}}
    - {"type": "sort", "by": "column", "ascending": True}
    - {"type": "dropna", "subset": ["col1"]}
    - {"type": "fillna", "value": 0}
    - {"type": "groupby", "by": ["col"], "agg": {"col2": "sum"}}
    """
    if name not in _dataframes:
        raise ValueError(f"No dataframe named '{name}'. Load data first.")

    df = _dataframes[name].copy()

    for op in operations:
        op_type = op.get("type")

        if op_type == "filter":
            df = df.query(op["query"])
        elif op_type == "select":
            df = df[op["columns"]]
        elif op_type == "rename":
            df = df.rename(columns=op["mapping"])
        elif op_type == "sort":
            df = df.sort_values(by=op["by"], ascending=op.get("ascending", True))
        elif op_type == "dropna":
            df = df.dropna(subset=op.get("subset"))
        elif op_type == "fillna":
            df = df.fillna(op["value"])
        elif op_type == "groupby":
            df = df.groupby(op["by"]).agg(op["agg"]).reset_index()

    result_name = output_name or f"{name}_transformed"
    _dataframes[result_name] = df

    return {
        "name": result_name,
        "rows": len(df),
        "columns": list(df.columns),
        "preview": df_to_text(df.head(20)),
    }


def aggregate_data(name: str, group_by: list[str], aggregations: dict[str, str]) -> dict:
    """
    Aggregate data with groupby.

    aggregations: {"column": "function"} where function is sum, mean, count, min, max, etc.
    """
    if name not in _dataframes:
        raise ValueError(f"No dataframe named '{name}'. Load data first.")

    df = _dataframes[name]
    result = df.groupby(group_by).agg(aggregations).reset_index()

    return {
        "name": name,
        "group_by": group_by,
        "aggregations": aggregations,
        "result": df_to_text(result),
    }


# ============================================================================
# CHARTING
# ============================================================================

def create_chart(
    name: str,
    chart_type: str,
    x: str,
    y: str | list[str],
    title: str | None = None,
    output: str | None = None,
    **kwargs
) -> dict:
    """Create a chart and save it."""
    if name not in _dataframes:
        raise ValueError(f"No dataframe named '{name}'. Load data first.")

    df = _dataframes[name]

    fig, ax = plt.subplots(figsize=(10, 6))

    if chart_type == "bar":
        if isinstance(y, list):
            df.plot(kind='bar', x=x, y=y, ax=ax, **kwargs)
        else:
            df.plot(kind='bar', x=x, y=y, ax=ax, **kwargs)
    elif chart_type == "line":
        if isinstance(y, list):
            for col in y:
                ax.plot(df[x], df[col], label=col, **kwargs)
            ax.legend()
        else:
            ax.plot(df[x], df[y], **kwargs)
    elif chart_type == "scatter":
        ax.scatter(df[x], df[y] if isinstance(y, str) else df[y[0]], **kwargs)
    elif chart_type == "pie":
        ax.pie(df[y] if isinstance(y, str) else df[y[0]], labels=df[x], autopct='%1.1f%%', **kwargs)
    elif chart_type == "histogram":
        ax.hist(df[y] if isinstance(y, str) else df[y[0]], bins=kwargs.get('bins', 20), **kwargs)
    elif chart_type == "box":
        df.boxplot(column=y if isinstance(y, list) else [y], ax=ax, **kwargs)

    if title:
        ax.set_title(title)
    ax.set_xlabel(x)
    if chart_type != "pie":
        ax.set_ylabel(y if isinstance(y, str) else ", ".join(y))

    plt.tight_layout()

    # Save chart
    ensure_output_dir()
    if output:
        output_path = expand_path(output)
    else:
        output_path = DEFAULT_OUTPUT_DIR / generate_filename(f"{chart_type}-chart", "png")

    plt.savefig(output_path, dpi=150, bbox_inches='tight')
    plt.close(fig)

    return {
        "chart_type": chart_type,
        "output_path": str(output_path),
        "title": title or f"{chart_type.title()} Chart",
    }


def export_data(name: str, output: str, format: str = "csv") -> dict:
    """Export a dataframe to file."""
    if name not in _dataframes:
        raise ValueError(f"No dataframe named '{name}'. Load data first.")

    df = _dataframes[name]
    output_path = expand_path(output)

    if format == "csv":
        df.to_csv(output_path, index=False)
    elif format == "excel":
        df.to_excel(output_path, index=False)
    elif format == "json":
        df.to_json(output_path, orient="records", indent=2)
    elif format == "parquet":
        df.to_parquet(output_path, index=False)

    return {
        "name": name,
        "format": format,
        "output_path": str(output_path),
        "rows": len(df),
    }


# ============================================================================
# MCP SERVER
# ============================================================================

server = Server("data-analysis")


@server.list_tools()
async def list_tools() -> list[types.Tool]:
    return [
        types.Tool(
            name="data_load_csv",
            description="Load a CSV file for analysis. Returns preview and column info.",
            inputSchema={
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Path to CSV file"},
                    "name": {"type": "string", "description": "Name to reference this data (optional, defaults to filename)"},
                },
                "required": ["path"],
            },
        ),
        types.Tool(
            name="data_load_excel",
            description="Load an Excel file for analysis.",
            inputSchema={
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Path to Excel file"},
                    "name": {"type": "string", "description": "Name to reference this data"},
                    "sheet": {"type": "string", "description": "Sheet name or index (default: first sheet)"},
                },
                "required": ["path"],
            },
        ),
        types.Tool(
            name="data_load_json",
            description="Load a JSON file for analysis.",
            inputSchema={
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Path to JSON file"},
                    "name": {"type": "string", "description": "Name to reference this data"},
                },
                "required": ["path"],
            },
        ),
        types.Tool(
            name="data_describe",
            description="Get statistical summary of loaded data (mean, std, min, max, etc).",
            inputSchema={
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "Name of loaded dataframe"},
                },
                "required": ["name"],
            },
        ),
        types.Tool(
            name="data_query",
            description="Query data using pandas syntax (e.g., 'age > 30 and city == \"NYC\"').",
            inputSchema={
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "Name of loaded dataframe"},
                    "query": {"type": "string", "description": "Pandas query string"},
                },
                "required": ["name", "query"],
            },
        ),
        types.Tool(
            name="data_transform",
            description="Transform data with operations like filter, select, sort, groupby, fillna.",
            inputSchema={
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "Name of loaded dataframe"},
                    "operations": {
                        "type": "array",
                        "description": "List of operations: filter, select, rename, sort, dropna, fillna, groupby",
                        "items": {"type": "object"},
                    },
                    "output_name": {"type": "string", "description": "Name for the transformed result"},
                },
                "required": ["name", "operations"],
            },
        ),
        types.Tool(
            name="data_aggregate",
            description="Aggregate data with groupby (sum, mean, count, min, max).",
            inputSchema={
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "Name of loaded dataframe"},
                    "group_by": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Columns to group by",
                    },
                    "aggregations": {
                        "type": "object",
                        "description": "Column: aggregation function mapping (e.g., {\"sales\": \"sum\"})",
                    },
                },
                "required": ["name", "group_by", "aggregations"],
            },
        ),
        types.Tool(
            name="data_chart",
            description="Create a chart (bar, line, scatter, pie, histogram, box) and save as PNG.",
            inputSchema={
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "Name of loaded dataframe"},
                    "chart_type": {
                        "type": "string",
                        "enum": ["bar", "line", "scatter", "pie", "histogram", "box"],
                        "description": "Type of chart",
                    },
                    "x": {"type": "string", "description": "Column for X axis (or labels for pie)"},
                    "y": {
                        "oneOf": [
                            {"type": "string"},
                            {"type": "array", "items": {"type": "string"}},
                        ],
                        "description": "Column(s) for Y axis (or values for pie)",
                    },
                    "title": {"type": "string", "description": "Chart title"},
                    "output": {"type": "string", "description": "Output path (optional, auto-generated if not provided)"},
                },
                "required": ["name", "chart_type", "x", "y"],
            },
        ),
        types.Tool(
            name="data_export",
            description="Export data to CSV, Excel, JSON, or Parquet.",
            inputSchema={
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "Name of dataframe to export"},
                    "output": {"type": "string", "description": "Output file path"},
                    "format": {
                        "type": "string",
                        "enum": ["csv", "excel", "json", "parquet"],
                        "description": "Export format",
                    },
                },
                "required": ["name", "output"],
            },
        ),
        types.Tool(
            name="data_list",
            description="List all loaded dataframes in memory.",
            inputSchema={
                "type": "object",
                "properties": {},
            },
        ),
    ]


@server.call_tool()
async def call_tool(name: str, arguments: dict) -> list[types.TextContent]:
    try:
        if name == "data_load_csv":
            result = load_csv(arguments["path"], arguments.get("name"))
            return [types.TextContent(type="text", text=f"Loaded '{result['name']}': {result['rows']} rows, {len(result['columns'])} columns\n\nColumns: {', '.join(result['columns'])}\n\nPreview:\n{result['preview']}")]

        elif name == "data_load_excel":
            result = load_excel(arguments["path"], arguments.get("name"), arguments.get("sheet", 0))
            return [types.TextContent(type="text", text=f"Loaded '{result['name']}': {result['rows']} rows, {len(result['columns'])} columns\n\nColumns: {', '.join(result['columns'])}\n\nPreview:\n{result['preview']}")]

        elif name == "data_load_json":
            result = load_json(arguments["path"], arguments.get("name"))
            return [types.TextContent(type="text", text=f"Loaded '{result['name']}': {result['rows']} rows, {len(result['columns'])} columns\n\nColumns: {', '.join(result['columns'])}\n\nPreview:\n{result['preview']}")]

        elif name == "data_describe":
            result = describe_data(arguments["name"])
            return [types.TextContent(type="text", text=f"Statistics for '{result['name']}' ({result['shape']['rows']} rows, {result['shape']['columns']} cols):\n\n{result['statistics']}\n\nMissing values: {result['missing']}")]

        elif name == "data_query":
            result = query_data(arguments["name"], arguments["query"])
            return [types.TextContent(type="text", text=f"Query: {result['query']}\nMatched: {result['rows_matched']} of {result['total_rows']} rows\n\n{result['result']}")]

        elif name == "data_transform":
            result = transform_data(arguments["name"], arguments["operations"], arguments.get("output_name"))
            return [types.TextContent(type="text", text=f"Transformed data saved as '{result['name']}': {result['rows']} rows\n\nColumns: {', '.join(result['columns'])}\n\nPreview:\n{result['preview']}")]

        elif name == "data_aggregate":
            result = aggregate_data(arguments["name"], arguments["group_by"], arguments["aggregations"])
            return [types.TextContent(type="text", text=f"Aggregation by {result['group_by']}:\n\n{result['result']}")]

        elif name == "data_chart":
            result = create_chart(
                arguments["name"],
                arguments["chart_type"],
                arguments["x"],
                arguments["y"],
                arguments.get("title"),
                arguments.get("output"),
            )
            return [types.TextContent(type="text", text=f"Chart created: {result['title']}\nSaved to: {result['output_path']}")]

        elif name == "data_export":
            result = export_data(arguments["name"], arguments["output"], arguments.get("format", "csv"))
            return [types.TextContent(type="text", text=f"Exported '{result['name']}' ({result['rows']} rows) to: {result['output_path']}")]

        elif name == "data_list":
            if not _dataframes:
                return [types.TextContent(type="text", text="No dataframes loaded. Use data_load_csv, data_load_excel, or data_load_json first.")]

            lines = ["Loaded dataframes:", ""]
            for df_name, df in _dataframes.items():
                lines.append(f"  {df_name}: {len(df)} rows, {len(df.columns)} columns")
                lines.append(f"    Columns: {', '.join(df.columns[:5])}{'...' if len(df.columns) > 5 else ''}")
            return [types.TextContent(type="text", text="\n".join(lines))]

        else:
            return [types.TextContent(type="text", text=f"Unknown tool: {name}")]

    except Exception as e:
        return [types.TextContent(type="text", text=f"Error: {str(e)}")]


# ============================================================================
# MAIN
# ============================================================================

async def main():
    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream, server.create_initialization_options())


if __name__ == "__main__":
    asyncio.run(main())
