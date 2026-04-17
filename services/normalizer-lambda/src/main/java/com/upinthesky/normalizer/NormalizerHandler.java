package com.upinthesky.normalizer;

import com.amazonaws.services.lambda.runtime.Context;
import com.amazonaws.services.lambda.runtime.RequestHandler;
import com.amazonaws.services.lambda.runtime.events.KinesisEvent;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.upinthesky.normalizer.model.Aircraft;
import com.upinthesky.normalizer.model.RouteInfo;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.dynamodb.DynamoDbClient;
import software.amazon.awssdk.services.dynamodb.model.AttributeValue;
import software.amazon.awssdk.services.dynamodb.model.GetItemRequest;
import software.amazon.awssdk.services.dynamodb.model.GetItemResponse;
import software.amazon.awssdk.services.dynamodb.model.PutItemRequest;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;

public class NormalizerHandler implements RequestHandler<KinesisEvent, String> {

    private static final DynamoDbClient dynamoDb = DynamoDbClient.builder()
            .region(Region.of(System.getenv().getOrDefault("AWS_REGION", "us-east-1")))
            .build();
    private static final ObjectMapper mapper = new ObjectMapper();
    private static final String TABLE_NAME = System.getenv("AIRCRAFT_TABLE_NAME");
    private static final long TTL_SECONDS = 24 * 3600L;
    private static final long ROUTE_REFRESH_SECONDS = 3600L;

    private final RouteEnricher routeEnricher = new RouteEnricher();

    @Override
    public String handleRequest(KinesisEvent event, Context context) {
        int processed = 0;
        int errors = 0;

        for (KinesisEvent.KinesisEventRecord record : event.getRecords()) {
            try {
                byte[] data = record.getKinesis().getData().array();
                String json = new String(data, StandardCharsets.UTF_8);
                Aircraft aircraft = mapper.readValue(json, Aircraft.class);

                if (aircraft.getHex() == null || aircraft.getHex().isBlank()) continue;
                if (aircraft.getLat() == null || aircraft.getLon() == null) continue;

                upsertAircraft(aircraft, context);
                processed++;
            } catch (Exception e) {
                errors++;
                context.getLogger().log("Normalize error: " + e.getMessage() + "\n");
            }
        }
        return String.format("processed=%d errors=%d", processed, errors);
    }

    private void upsertAircraft(Aircraft a, Context context) {
        String icao24 = a.getHex().toLowerCase();
        String callsign = a.getFlight();
        long now = Instant.now().getEpochSecond();

        Map<String, AttributeValue> item = new HashMap<>();
        item.put("icao24", str(icao24));
        item.put("updatedAt", str(Instant.now().toString()));
        item.put("ttl", num(String.valueOf(now + TTL_SECONDS)));

        if (callsign != null && !callsign.isBlank()) {
            item.put("callsign", str(callsign));
        }
        if (a.getLat() != null) item.put("lat", num(String.valueOf(a.getLat())));
        if (a.getLon() != null) item.put("lon", num(String.valueOf(a.getLon())));
        if (a.getAltitudeFeet() != null) item.put("altitude", num(String.valueOf(a.getAltitudeFeet())));
        if (a.getGs() != null) item.put("groundSpeed", num(String.valueOf(a.getGs())));
        if (a.getTrack() != null) item.put("track", num(String.valueOf(a.getTrack())));
        item.put("onGround", bool(a.isOnGround()));

        // Route enrichment: fetch on first sight or if routeUpdatedAt is > 1 hour old
        if (callsign != null && !callsign.isBlank() && shouldRefreshRoute(icao24, now)) {
            try {
                RouteInfo route = routeEnricher.fetchRoute(callsign);
                if (route != null && route.getOrigin() != null) {
                    item.put("origin", str(route.getOrigin().getIata()));
                    item.put("destination", str(route.getDestination().getIata()));
                    item.put("routeUpdatedAt", str(Instant.now().toString()));
                }
            } catch (Exception e) {
                context.getLogger().log("Route enrichment failed for " + callsign + ": " + e.getMessage() + "\n");
            }
        } else {
            // Preserve existing route fields — only update position fields
            Map<String, AttributeValue> existing = getExistingRoute(icao24);
            if (existing != null) {
                if (existing.containsKey("origin")) item.put("origin", existing.get("origin"));
                if (existing.containsKey("destination")) item.put("destination", existing.get("destination"));
                if (existing.containsKey("routeUpdatedAt")) item.put("routeUpdatedAt", existing.get("routeUpdatedAt"));
            }
        }

        dynamoDb.putItem(PutItemRequest.builder()
                .tableName(TABLE_NAME)
                .item(item)
                .build());
    }

    private boolean shouldRefreshRoute(String icao24, long nowEpochSeconds) {
        Map<String, AttributeValue> existing = getExistingRoute(icao24);
        if (existing == null || !existing.containsKey("routeUpdatedAt")) return true;
        try {
            String routeUpdatedAt = existing.get("routeUpdatedAt").s();
            long routeAge = nowEpochSeconds - Instant.parse(routeUpdatedAt).getEpochSecond();
            return routeAge > ROUTE_REFRESH_SECONDS;
        } catch (Exception e) {
            return true;
        }
    }

    private Map<String, AttributeValue> getExistingRoute(String icao24) {
        try {
            GetItemResponse response = dynamoDb.getItem(GetItemRequest.builder()
                    .tableName(TABLE_NAME)
                    .key(Map.of("icao24", str(icao24)))
                    .projectionExpression("origin, destination, routeUpdatedAt")
                    .build());
            return response.hasItem() ? response.item() : null;
        } catch (Exception e) {
            return null;
        }
    }

    private static AttributeValue str(String s) {
        return AttributeValue.builder().s(s).build();
    }

    private static AttributeValue num(String n) {
        return AttributeValue.builder().n(n).build();
    }

    private static AttributeValue bool(boolean b) {
        return AttributeValue.builder().bool(b).build();
    }
}
