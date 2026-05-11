import json
import os
import time
import boto3
import anthropic
from boto3.dynamodb.conditions import Attr, Key
from concurrent.futures import ThreadPoolExecutor, as_completed
from decimal import Decimal
from fastapi import FastAPI, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import AsyncGenerator

app = FastAPI()

MODEL_ID = os.environ.get("MODEL_ID", "claude-sonnet-4-20250514")
MCP_LAMBDA_ARN = os.environ.get("MCP_LAMBDA_ARN", "")
ANTHROPIC_API_KEY_PARAM = os.environ.get("ANTHROPIC_API_KEY_PARAM", "")

_anthropic_client: anthropic.Anthropic | None = None
_lambda_client = None
_ssm_client = None


def get_ssm_client():
    global _ssm_client
    if _ssm_client is None:
        _ssm_client = boto3.client("ssm")
    return _ssm_client


def get_anthropic_client() -> anthropic.Anthropic:
    global _anthropic_client
    if _anthropic_client is None:
        api_key = os.environ.get("ANTHROPIC_API_KEY", "")
        if not api_key and ANTHROPIC_API_KEY_PARAM:
            resp = get_ssm_client().get_parameter(
                Name=ANTHROPIC_API_KEY_PARAM, WithDecryption=True
            )
            api_key = resp["Parameter"]["Value"]
        _anthropic_client = anthropic.Anthropic(api_key=api_key)
    return _anthropic_client


def get_lambda_client():
    global _lambda_client
    if _lambda_client is None:
        _lambda_client = boto3.client("lambda")
    return _lambda_client


TOOLS = [
    {
        "name": "get_aircraft_position",
        "description": (
            "Get real-time position, altitude, speed, and heading for an aircraft "
            "by its callsign (e.g. AAL123) or ICAO24 hex code (e.g. a1b2c3)."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "callsign": {
                    "type": "string",
                    "description": "ICAO callsign or flight number (e.g. AAL123)",
                },
                "icao24": {
                    "type": "string",
                    "description": "ICAO24 hex transponder code (e.g. a1b2c3)",
                },
            },
        },
    },
    {
        "name": "get_aircraft_nearby",
        "description": "Get all aircraft currently visible within a radius of a geographic point.",
        "input_schema": {
            "type": "object",
            "properties": {
                "lat": {"type": "number", "description": "Center latitude (decimal degrees)"},
                "lon": {"type": "number", "description": "Center longitude (decimal degrees)"},
                "radius_nm": {"type": "number", "description": "Search radius in nautical miles (max 500)"},
            },
            "required": ["lat", "lon", "radius_nm"],
        },
    },
]

SYSTEM_PROMPT = (
    "You are a helpful flight tracking assistant with access to live ADS-B data. "
    "You can look up real-time aircraft positions, altitudes, speeds, and routes. "
    "Be concise and accurate. When queried about specific flights, use the available tools. "
    "If data is unavailable or you're uncertain, say so clearly."
)

MOCK_TOOL_RESPONSES: dict[str, dict] = {
    "get_aircraft_position": {
        "result": {
            "callsign": "UNKNOWN",
            "altitude": 35000,
            "groundSpeed": 450,
            "track": 270,
            "lat": 39.5,
            "lon": -98.0,
        }
    },
    "get_aircraft_nearby": {
        "result": [
            {"callsign": "AAL123", "altitude": 38000, "groundSpeed": 480},
            {"callsign": "UAL456", "altitude": 32000, "groundSpeed": 460},
            {"callsign": "DAL789", "altitude": 41000, "groundSpeed": 490},
        ]
    },
}


class Message(BaseModel):
    role: str
    content: str | list


class ChatRequest(BaseModel):
    message: str
    history: list[Message] = []


def sse(event_type: str, data: dict) -> bytes:
    return f"event: {event_type}\ndata: {json.dumps(data)}\n\n".encode()


def invoke_tool(tool_name: str, tool_input: dict) -> str:
    if not MCP_LAMBDA_ARN:
        mock = dict(MOCK_TOOL_RESPONSES.get(tool_name, {"error": f"unknown tool: {tool_name}"}))
        if tool_name == "get_aircraft_position" and "result" in mock:
            mock = {"result": dict(mock["result"])}
            mock["result"]["callsign"] = tool_input.get("callsign") or tool_input.get("icao24", "UNKNOWN")
        return json.dumps(mock)
    try:
        resp = get_lambda_client().invoke(
            FunctionName=MCP_LAMBDA_ARN,
            InvocationType="RequestResponse",
            Payload=json.dumps({"tool": tool_name, "input": tool_input}),
        )
        return resp["Payload"].read().decode()
    except Exception as e:
        return json.dumps({"error": str(e)})


async def stream_chat(request: ChatRequest) -> AsyncGenerator[bytes, None]:
    client = get_anthropic_client()
    messages = [{"role": m.role, "content": m.content} for m in request.history]
    messages.append({"role": "user", "content": request.message})

    try:
        while True:
            current_text = ""
            tool_uses: list[dict] = []

            with client.messages.stream(
                model=MODEL_ID,
                max_tokens=1024,
                system=SYSTEM_PROMPT,
                tools=TOOLS,
                messages=messages,
            ) as stream:
                for event in stream:
                    if event.type == "content_block_start":
                        block = event.content_block
                        if block.type == "tool_use":
                            tool_uses.append({"id": block.id, "name": block.name, "input_raw": ""})
                            yield sse("tool_start", {"name": block.name})
                    elif event.type == "content_block_delta":
                        delta = event.delta
                        if delta.type == "text_delta":
                            current_text += delta.text
                            yield sse("token", {"text": delta.text})
                        elif delta.type == "input_json_delta" and tool_uses:
                            tool_uses[-1]["input_raw"] += delta.partial_json

                stop_reason = stream.get_final_message().stop_reason

            if stop_reason != "tool_use":
                break

            assistant_content: list[dict] = []
            if current_text:
                assistant_content.append({"type": "text", "text": current_text})

            tool_results: list[dict] = []
            for tu in tool_uses:
                try:
                    tool_input = json.loads(tu["input_raw"]) if tu["input_raw"] else {}
                except json.JSONDecodeError:
                    tool_input = {}

                result = invoke_tool(tu["name"], tool_input)
                assistant_content.append(
                    {"type": "tool_use", "id": tu["id"], "name": tu["name"], "input": tool_input}
                )
                tool_results.append(
                    {"type": "tool_result", "tool_use_id": tu["id"], "content": result}
                )
                yield sse("tool_end", {"name": tu["name"]})

            messages.append({"role": "assistant", "content": assistant_content})
            messages.append({"role": "user", "content": tool_results})

        yield sse("done", {})

    except anthropic.APIError as e:
        yield sse("error", {"message": str(e)})
    except Exception as e:
        yield sse("error", {"message": f"{type(e).__name__}: {e}"})


@app.post("/chat")
async def chat(request: ChatRequest) -> StreamingResponse:
    return StreamingResponse(
        stream_chat(request),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


AIRCRAFT_TABLE = os.environ.get("AIRCRAFT_TABLE_NAME", "Aircraft")
_ddb_resource = None


def get_aircraft_table():
    global _ddb_resource
    if _ddb_resource is None:
        _ddb_resource = boto3.resource("dynamodb")
    return _ddb_resource.Table(AIRCRAFT_TABLE)


def decimal_to_float(obj):
    if isinstance(obj, Decimal):
        return float(obj)
    if isinstance(obj, dict):
        return {k: decimal_to_float(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [decimal_to_float(i) for i in obj]
    return obj


# Precision-2 geohash cell dimensions.
# 10 bits: 5 lon bits → 360/32 = 11.25° wide, 5 lat bits → 180/32 = 5.625° tall.
_GH2_CELL_LAT = 180.0 / 32
_GH2_CELL_LON = 360.0 / 32
_BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz"


def _encode_gh2(lat: float, lon: float) -> str:
    min_lat, max_lat = -90.0, 90.0
    min_lon, max_lon = -180.0, 180.0
    bits = 0
    hash_val = 0
    is_lon = True
    result: list[str] = []
    while len(result) < 2:
        if is_lon:
            mid = (min_lon + max_lon) / 2
            if lon >= mid:
                hash_val = (hash_val << 1) | 1
                min_lon = mid
            else:
                hash_val <<= 1
                max_lon = mid
        else:
            mid = (min_lat + max_lat) / 2
            if lat >= mid:
                hash_val = (hash_val << 1) | 1
                min_lat = mid
            else:
                hash_val <<= 1
                max_lat = mid
        is_lon = not is_lon
        bits += 1
        if bits == 5:
            result.append(_BASE32[hash_val])
            bits = 0
            hash_val = 0
    return "".join(result)


def _gh2_cells_in_bbox(
    min_lat: float, max_lat: float, min_lon: float, max_lon: float
) -> list[str]:
    # Snap to the SW corner of the geohash grid cell that contains the SW viewport corner.
    sw_lat = int((min_lat + 90) / _GH2_CELL_LAT) * _GH2_CELL_LAT - 90
    sw_lon = int((min_lon + 180) / _GH2_CELL_LON) * _GH2_CELL_LON - 180
    cells: list[str] = []
    lat = sw_lat
    while lat < max_lat:
        lon = sw_lon
        while lon < max_lon:
            cells.append(_encode_gh2(lat + _GH2_CELL_LAT / 2, lon + _GH2_CELL_LON / 2))
            lon += _GH2_CELL_LON
        lat += _GH2_CELL_LAT
    return cells


@app.get("/aircraft")
async def get_aircraft(
    min_lat: float = Query(...),
    max_lat: float = Query(...),
    min_lon: float = Query(...),
    max_lon: float = Query(...),
):
    table = get_aircraft_table()
    now = int(time.time())
    cells = _gh2_cells_in_bbox(min_lat, max_lat, min_lon, max_lon)

    def _query_cell(cell: str) -> list[dict]:
        items: list[dict] = []
        kwargs: dict = {
            "IndexName": "gh2-index",
            "KeyConditionExpression": Key("gh2").eq(cell),
            "ProjectionExpression": "icao24, callsign, lat, lon, altitude, groundSpeed, track, onGround, updatedAt, #ttl",
            "ExpressionAttributeNames": {"#ttl": "ttl"},
        }
        while True:
            resp = table.query(**kwargs)
            items.extend(resp.get("Items", []))
            last_key = resp.get("LastEvaluatedKey")
            if not last_key:
                break
            kwargs["ExclusiveStartKey"] = last_key
        return items

    all_items: list[dict] = []
    max_workers = min(len(cells), 20)
    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        futures = {pool.submit(_query_cell, cell): cell for cell in cells}
        for future in as_completed(futures):
            all_items.extend(future.result())

    # Filter to the exact viewport bounds and exclude TTL-expired items.
    filtered = [
        item for item in all_items
        if (
            min_lat <= float(item["lat"]) <= max_lat
            and min_lon <= float(item["lon"]) <= max_lon
            and int(item.get("ttl", 0)) > now
        )
    ]

    return {"aircraft": decimal_to_float(filtered)}


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}
