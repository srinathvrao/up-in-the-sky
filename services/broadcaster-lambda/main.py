import base64
import json
import os
import time

import boto3
from botocore.exceptions import ClientError

CONNECTIONS_TABLE = os.environ["CONNECTIONS_TABLE"]
WS_MANAGEMENT_ENDPOINT = os.environ["WS_MANAGEMENT_ENDPOINT"]

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


def build_ws_message(ac: dict) -> bytes | None:
    hex_id = (ac.get("hex") or "").strip().lower()
    if not hex_id or ac.get("lat") is None or ac.get("lon") is None:
        return None

    alt_baro = ac.get("alt_baro")
    on_ground = alt_baro == "ground"
    altitude = 0 if on_ground else (int(alt_baro) if isinstance(alt_baro, (int, float)) else 0)

    polled_at = ac.get("polledAt")
    updated_at = (
        time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(polled_at / 1000))
        if polled_at
        else time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    )

    msg = {
        "type": "aircraft_update",
        "data": {
            "icao24": hex_id,
            "callsign": (ac.get("flight") or "").strip(),
            "lat": ac.get("lat", 0),
            "lon": ac.get("lon", 0),
            "altitude": altitude,
            "groundSpeed": int(ac.get("gs") or 0),
            "track": int(ac.get("track") or 0),
            "onGround": on_ground,
            "updatedAt": updated_at,
        },
    }
    return json.dumps(msg).encode("utf-8")


def handler(event, context):
    # Decode all Kinesis records into aircraft objects
    aircraft_list: list[dict] = []
    for record in event.get("Records", []):
        try:
            raw = base64.b64decode(record["kinesis"]["data"]).decode("utf-8")
            parsed = json.loads(raw)
            if isinstance(parsed, list):
                aircraft_list.extend(parsed)
            elif isinstance(parsed, dict):
                aircraft_list.append(parsed)
        except Exception as e:
            print(f"decode error: {e}")

    if not aircraft_list:
        return

    # Fetch all active connection IDs
    table = get_ddb().Table(CONNECTIONS_TABLE)
    scan_resp = table.scan(ProjectionExpression="connectionId")
    conn_ids: list[str] = [item["connectionId"] for item in scan_resp.get("Items", [])]

    if not conn_ids:
        return

    # Build messages and broadcast
    apigw = get_apigw()
    stale: set[str] = set()

    for ac in aircraft_list:
        msg = build_ws_message(ac)
        if not msg:
            continue
        for conn_id in conn_ids:
            if conn_id in stale:
                continue
            try:
                apigw.post_to_connection(ConnectionId=conn_id, Data=msg)
            except ClientError as e:
                code = e.response["Error"]["Code"]
                if code in ("GoneException", "410"):
                    stale.add(conn_id)
                else:
                    print(f"post error {conn_id}: {e}")
            except Exception as e:
                print(f"post error {conn_id}: {e}")

    # Remove stale connections
    for conn_id in stale:
        try:
            table.delete_item(Key={"connectionId": conn_id})
        except Exception as e:
            print(f"cleanup error {conn_id}: {e}")

    print(f"broadcast: aircraft={len(aircraft_list)} connections={len(conn_ids)} stale={len(stale)}")
