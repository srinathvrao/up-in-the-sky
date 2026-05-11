package com.upinthesky.mcp.tools;

import com.amazonaws.services.lambda.runtime.LambdaLogger;
import com.upinthesky.mcp.model.AircraftPosition;
import software.amazon.awssdk.services.dynamodb.DynamoDbClient;
import software.amazon.awssdk.services.dynamodb.model.*;

import java.util.Collections;
import java.util.List;
import java.util.Map;

public class GetAircraftPosition {

    private final DynamoDbClient dynamoDb;
    private final String tableName;

    public GetAircraftPosition(DynamoDbClient dynamoDb, String tableName) {
        this.dynamoDb = dynamoDb;
        this.tableName = tableName;
    }

    public AircraftPosition execute(Map<String, Object> input, LambdaLogger logger) {
        String icao24 = (String) input.get("icao24");
        String callsign = (String) input.get("callsign");

        if (icao24 != null && !icao24.isBlank()) {
            return getByIcao24(icao24.toLowerCase(), logger);
        } else if (callsign != null && !callsign.isBlank()) {
            return getByCallsign(callsign.trim().toUpperCase(), logger);
        }
        return null;
    }

    private AircraftPosition getByIcao24(String icao24, LambdaLogger logger) {
        try {
            GetItemResponse response = dynamoDb.getItem(GetItemRequest.builder()
                    .tableName(tableName)
                    .key(Map.of("icao24", AttributeValue.builder().s(icao24).build()))
                    .build());
            if (!response.hasItem()) return null;
            return mapItem(response.item());
        } catch (Exception e) {
            logger.log("DynamoDB GetItem failed for icao24=" + icao24 + ": " + e.getMessage());
            return null;
        }
    }

    private AircraftPosition getByCallsign(String callsign, LambdaLogger logger) {
        try {
            QueryResponse response = dynamoDb.query(QueryRequest.builder()
                    .tableName(tableName)
                    .indexName("callsign-index")
                    .keyConditionExpression("callsign = :cs")
                    .expressionAttributeValues(Map.of(
                            ":cs", AttributeValue.builder().s(callsign).build()
                    ))
                    .limit(1)
                    .build());
            List<Map<String, AttributeValue>> items = response.items();
            if (items.isEmpty()) return null;
            return mapItem(items.get(0));
        } catch (Exception e) {
            logger.log("DynamoDB Query failed for callsign=" + callsign + ": " + e.getMessage());
            return null;
        }
    }

    private AircraftPosition mapItem(Map<String, AttributeValue> item) {
        AircraftPosition pos = new AircraftPosition();
        pos.setIcao24(str(item, "icao24"));
        pos.setCallsign(str(item, "callsign"));
        pos.setLat(num(item, "lat"));
        pos.setLon(num(item, "lon"));
        pos.setAltitude(item.containsKey("altitude") ? (int) Double.parseDouble(item.get("altitude").n()) : null);
        pos.setGroundSpeed(num(item, "groundSpeed"));
        pos.setTrack(num(item, "track"));
        AttributeValue onGround = item.get("onGround");
        if (onGround != null) pos.setOnGround(onGround.bool());
        pos.setOrigin(str(item, "origin"));
        pos.setDestination(str(item, "destination"));
        pos.setUpdatedAt(str(item, "updatedAt"));
        return pos;
    }

    private static String str(Map<String, AttributeValue> item, String key) {
        AttributeValue v = item.get(key);
        return (v != null && v.s() != null) ? v.s() : null;
    }

    private static Double num(Map<String, AttributeValue> item, String key) {
        AttributeValue v = item.get(key);
        if (v == null || v.n() == null) return null;
        try { return Double.parseDouble(v.n()); } catch (NumberFormatException e) { return null; }
    }
}
