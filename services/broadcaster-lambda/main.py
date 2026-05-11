import base64
import json
import os
import time

import boto3
from botocore.exceptions import ClientError

CONNECTIONS_TABLE = os.environ["CONNECTIONS_TABLE"]
WS_MANAGEMENT_ENDPOINT = os.environ["WS_MANAGEMENT_ENDPOINT"]

# API GW WebSocket max payload is 128 KB; ~160 bytes/aircraft → ~800 per chunk
CHUNK_SIZE = 700

_ddb = None
_apigw = None


def get_ddb():
    global _ddb
    if _ddb is None:
        _ddb = boto3.resource("dynamodb")
    return _ddb


def get_apigw():
    global _apigw
    if _apigw is None:
        _apigw = boto3.client(
            "apigatewaymanagementapi", endpoint_url=WS_MANAGEMENT_ENDPOINT
        )
    return _apigw


def normalize(ac: dict) -> dict | None:
    hex_id = (ac.get("hex") or "").strip().lower()
    if not hex_id or ac.get("lat") is None or ac.get("lon") is None:
        return None

    alt_baro = ac.get("alt_baro")
    on_ground = ac.get("onGround") if "onGround" in ac else (alt_baro == "ground")
    altitude = ac.get("altitudeFeet") or (
        0 if on_ground else (int(alt_baro) if isinstance(alt_baro, (int, float)) else 0)
    )

    polled_at = ac.get("polledAt")
    updated_at = (
        time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(polled_at / 1000))
        if polled_at
        else time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    )

    return {
        "icao24": hex_id,
        "callsign": (ac.get("flight") or "").strip(),
        "lat": ac.get("lat", 0),
        "lon": ac.get("lon", 0),
        "altitude": altitude,
        "groundSpeed": int(ac.get("gs") or 0),
        "track": int(ac.get("track") or 0),
        "onGround": bool(on_ground),
        "updatedAt": updated_at,
    }


def send_to_connection(conn_id: str, chunks: list[bytes]) -> bool:
    """Returns True if connection is stale."""
    apigw = get_apigw()
    for chunk in chunks:
        try:
            apigw.post_to_connection(ConnectionId=conn_id, Data=chunk)
        except ClientError as e:
            code = e.response["Error"]["Code"]
            if code in ("GoneException", "410"):
                return True
            print(f"post error {conn_id}: {e}")
    return False


def handler(event, context):
    # Decode Kinesis records, deduplicate by icao24 (last write wins)
    seen: dict[str, dict] = {}
    for record in event.get("Records", []):
        try:
            raw = base64.b64decode(record["kinesis"]["data"]).decode("utf-8")
            parsed = json.loads(raw)
            items = parsed if isinstance(parsed, list) else [parsed]
            for ac in items:
                hex_id = (ac.get("hex") or "").strip().lower()
                if hex_id:
                    seen[hex_id] = ac
        except Exception as e:
            print(f"decode error: {e}")

    if not seen:
        return

    # Normalize and build chunked payloads
    normalized = [n for ac in seen.values() if (n := normalize(ac))]
    if not normalized:
        return

    # Split into chunks small enough to fit within API GW's 128 KB message limit
    chunks: list[bytes] = []
    for i in range(0, len(normalized), CHUNK_SIZE):
        batch = normalized[i : i + CHUNK_SIZE]
        chunks.append(json.dumps({"type": "aircraft_batch", "data": batch}).encode("utf-8"))

    # Fetch active connections
    table = get_ddb().Table(CONNECTIONS_TABLE)
    scan_resp = table.scan(ProjectionExpression="connectionId")
    conn_ids: list[str] = [item["connectionId"] for item in scan_resp.get("Items", [])]

    if not conn_ids:
        return

    # Broadcast — one set of chunk calls per connection
    stale: set[str] = set()
    for conn_id in conn_ids:
        if send_to_connection(conn_id, chunks):
            stale.add(conn_id)

    # Remove stale connections
    for conn_id in stale:
        try:
            table.delete_item(Key={"connectionId": conn_id})
        except Exception as e:
            print(f"cleanup error {conn_id}: {e}")

    print(
        f"broadcast: aircraft={len(normalized)} chunks={len(chunks)} "
        f"connections={len(conn_ids)} stale={len(stale)}"
    )
