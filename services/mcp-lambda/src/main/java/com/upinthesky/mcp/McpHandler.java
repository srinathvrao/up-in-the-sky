package com.upinthesky.mcp;

import com.amazonaws.services.lambda.runtime.Context;
import com.amazonaws.services.lambda.runtime.RequestHandler;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.upinthesky.mcp.model.AircraftPosition;
import com.upinthesky.mcp.tools.GetAircraftNearby;
import com.upinthesky.mcp.tools.GetAircraftPosition;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.dynamodb.DynamoDbClient;

import java.util.Collections;
import java.util.List;
import java.util.Map;

public class McpHandler implements RequestHandler<Map<String, Object>, Map<String, Object>> {

    private static final DynamoDbClient dynamoDb = DynamoDbClient.builder()
            .region(Region.of(System.getenv().getOrDefault("AWS_REGION", "us-east-1")))
            .build();
    private static final ObjectMapper mapper = new ObjectMapper();

    private static final String TABLE_NAME = System.getenv("AIRCRAFT_TABLE_NAME");
    private static final String ADSB_BASE_URL = System.getenv().getOrDefault(
            "ADSB_BASE_URL", "https://api.adsb.lol");

    private final GetAircraftPosition getAircraftPosition = new GetAircraftPosition(dynamoDb, TABLE_NAME);
    private final GetAircraftNearby getAircraftNearby = new GetAircraftNearby(ADSB_BASE_URL);

    @Override
    @SuppressWarnings("unchecked")
    public Map<String, Object> handleRequest(Map<String, Object> event, Context context) {
        String tool = (String) event.get("tool");
        Map<String, Object> input = (Map<String, Object>) event.getOrDefault("input", Collections.emptyMap());

        if (tool == null) {
            return Map.of("error", "missing required field: tool");
        }

        return switch (tool) {
            case "get_aircraft_position" -> handleGetAircraftPosition(input, context);
            case "get_aircraft_nearby" -> handleGetAircraftNearby(input, context);
            default -> Map.of("error", "unknown tool: " + tool);
        };
    }

    private Map<String, Object> handleGetAircraftPosition(Map<String, Object> input, Context context) {
        try {
            AircraftPosition pos = getAircraftPosition.execute(input, context.getLogger());
            if (pos == null) {
                return Map.of("error", "aircraft not found");
            }
            return Map.of("result", mapper.convertValue(pos, Map.class));
        } catch (Exception e) {
            context.getLogger().log("get_aircraft_position error: " + e.getMessage());
            return Map.of("error", "internal error: " + e.getMessage());
        }
    }

    private Map<String, Object> handleGetAircraftNearby(Map<String, Object> input, Context context) {
        try {
            List<AircraftPosition> positions = getAircraftNearby.execute(input, context.getLogger());
            List<Map> positionMaps = positions.stream()
                    .map(p -> mapper.convertValue(p, Map.class))
                    .toList();
            return Map.of("result", positionMaps);
        } catch (Exception e) {
            context.getLogger().log("get_aircraft_nearby error: " + e.getMessage());
            return Map.of("error", "internal error: " + e.getMessage(), "result", Collections.emptyList());
        }
    }
}
