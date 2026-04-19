import json
import os
import boto3
import anthropic
from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import AsyncGenerator

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

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


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}
