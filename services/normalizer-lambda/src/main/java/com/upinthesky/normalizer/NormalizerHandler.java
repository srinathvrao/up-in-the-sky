package com.upinthesky.normalizer;

import com.amazonaws.services.lambda.runtime.Context;
import com.amazonaws.services.lambda.runtime.RequestHandler;
import com.amazonaws.services.lambda.runtime.events.KinesisEvent;
import com.fasterxml.jackson.core.type.TypeReference;
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
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

public class NormalizerHandler implements RequestHandler<KinesisEvent, String> {

    private static final DynamoDbClient dynamoDb = DynamoDbClient.builder()
            .region(Region.of(System.getenv().getOrDefault("AWS_REGION", "us-east-1")))
            .build();
    private static final ObjectMapper mapper = new ObjectMapper();
    private static final TypeReference<List<Aircraft>> AIRCRAFT_LIST = new TypeReference<>() {};
    private static final String TABLE_NAME = System.getenv("AIRCRAFT_TABLE_NAME");
    private static final long TTL_SECONDS = 24 * 3600L;
    private static final long ROUTE_REFRESH_SECONDS = 3600L;

    // In-memory dedup cache: icao24 → [lastWriteEpochSec, latBits, lonBits]
    private static final ConcurrentHashMap<String, long[]> writeCache = new ConcurrentHashMap<>();
    private static final long MIN_WRITE_INTERVAL_SEC = 30;
    private static final double MIN_POSITION_DELTA_DEG = 0.01;

    // Route timestamp cache: icao24 → routeUpdatedAt epoch sec (-1 = no route)
    // Avoids a DynamoDB GetItem on every aircraft just to check route age.
    private static final ConcurrentHashMap<String, Long> routeAgeCache = new ConcurrentHashMap<>();

    // Cap route API calls per invocation to avoid blowing the Lambda timeout on cold starts.
    private static final int MAX_ROUTE_LOOKUPS_PER_INVOCATION = 10;

    private final RouteEnricher routeEnricher = new RouteEnricher();

    @Override
    public String handleRequest(KinesisEvent event, Context context) {
        int processed = 0;
        int skipped = 0;
        int errors = 0;
        AtomicInteger routeLookups = new AtomicInteger(0);

        for (KinesisEvent.KinesisEventRecord record : event.getRecords()) {
            try {
                byte[] data = record.getKinesis().getData().array();
                String json = new String(data, StandardCharsets.UTF_8).trim();

                List<Aircraft> batch = json.startsWith("[")
                        ? mapper.readValue(json, AIRCRAFT_LIST)
                        : Collections.singletonList(mapper.readValue(json, Aircraft.class));

                for (Aircraft aircraft : batch) {
                    if (aircraft.getHex() == null || aircraft.getHex().isBlank()) continue;
                    if (aircraft.getLat() == null || aircraft.getLon() == null) continue;

                    if (shouldWrite(aircraft.getHex().toLowerCase(), aircraft.getLat(), aircraft.getLon())) {
                        upsertAircraft(aircraft, context, routeLookups);
                        processed++;
                    } else {
                        skipped++;
                    }
                }
            } catch (Exception e) {
                errors++;
                context.getLogger().log("Normalize error: " + e.getMessage() + "\n");
            }
        }
        context.getLogger().log(String.format("processed=%d skipped=%d errors=%d routeLookups=%d%n",
                processed, skipped, errors, routeLookups.get()));
        return String.format("processed=%d skipped=%d errors=%d", processed, skipped, errors);
    }

    private boolean shouldWrite(String icao24, double lat, double lon) {
        long now = Instant.now().getEpochSecond();
        long[] cached = writeCache.get(icao24);
        if (cached == null) {
            updateCache(icao24, lat, lon, now);
            return true;
        }
        long lastWrite = cached[0];
        double lastLat = Double.longBitsToDouble(cached[1]);
        double lastLon = Double.longBitsToDouble(cached[2]);

        boolean stale = (now - lastWrite) >= MIN_WRITE_INTERVAL_SEC;
        boolean moved = Math.abs(lat - lastLat) >= MIN_POSITION_DELTA_DEG
                || Math.abs(lon - lastLon) >= MIN_POSITION_DELTA_DEG;

        if (stale || moved) {
            updateCache(icao24, lat, lon, now);
            return true;
        }
        return false;
    }

    private void updateCache(String icao24, double lat, double lon, long epochSec) {
        writeCache.put(icao24, new long[]{
                epochSec,
                Double.doubleToLongBits(lat),
                Double.doubleToLongBits(lon)
        });
    }

    private void upsertAircraft(Aircraft a, Context context, AtomicInteger routeLookups) {
        String icao24 = a.getHex().toLowerCase();
        String callsign = a.getFlight();
        long now = Instant.now().getEpochSecond();

        Map<String, AttributeValue> item = new HashMap<>();
        item.put("icao24", str(icao24));
        item.put("updatedAt", str(Instant.now().toString()));
        item.put("ttl", num(String.valueOf(now + TTL_SECONDS)));

        if (callsign != null && !callsign.isBlank()) item.put("callsign", str(callsign));
        if (a.getLat() != null) item.put("lat", num(String.valueOf(a.getLat())));
        if (a.getLon() != null) item.put("lon", num(String.valueOf(a.getLon())));
        if (a.getAltitudeFeet() != null) item.put("altitude", num(String.valueOf(a.getAltitudeFeet())));
        if (a.getGs() != null) item.put("groundSpeed", num(String.valueOf(a.getGs())));
        if (a.getTrack() != null) item.put("track", num(String.valueOf(a.getTrack())));
        item.put("onGround", bool(a.isOnGround()));

        // Single DynamoDB read: fetch existing record for route fields.
        // routeAgeCache avoids re-reading DynamoDB on warm invocations for aircraft we've already processed.
        boolean needsRouteRefresh = false;
        Map<String, AttributeValue> existing = null;

        if (callsign != null && !callsign.isBlank()) {
            Long cachedRouteAge = routeAgeCache.get(icao24);
            if (cachedRouteAge == null) {
                // Not in route cache — read DynamoDB once to get both route fields and route age.
                existing = getExistingRecord(icao24);
                if (existing != null && existing.containsKey("routeUpdatedAt")) {
                    try {
                        long routeAge = now - Instant.parse(existing.get("routeUpdatedAt").s()).getEpochSecond();
                        routeAgeCache.put(icao24, now - routeAge);
                        needsRouteRefresh = routeAge > ROUTE_REFRESH_SECONDS;
                    } catch (Exception e) {
                        needsRouteRefresh = true;
                    }
                } else {
                    needsRouteRefresh = true;
                }
            } else {
                needsRouteRefresh = (now - cachedRouteAge) > ROUTE_REFRESH_SECONDS;
            }
        }

        if (needsRouteRefresh && routeLookups.get() < MAX_ROUTE_LOOKUPS_PER_INVOCATION) {
            try {
                RouteInfo route = routeEnricher.fetchRoute(callsign);
                if (route != null && route.getOrigin() != null) {
                    item.put("origin", str(route.getOrigin().getIata()));
                    item.put("destination", str(route.getDestination().getIata()));
                    item.put("routeUpdatedAt", str(Instant.now().toString()));
                    routeAgeCache.put(icao24, now);
                }
                routeLookups.incrementAndGet();
            } catch (Exception e) {
                context.getLogger().log("Route enrichment failed for " + callsign + ": " + e.getMessage() + "\n");
            }
        } else if (!needsRouteRefresh) {
            // Copy route fields from existing record (already fetched above) or from nothing.
            if (existing == null) {
                existing = getExistingRecord(icao24);
            }
            if (existing != null) {
                if (existing.containsKey("origin")) item.put("origin", existing.get("origin"));
                if (existing.containsKey("destination")) item.put("destination", existing.get("destination"));
                if (existing.containsKey("routeUpdatedAt")) item.put("routeUpdatedAt", existing.get("routeUpdatedAt"));
            }
        }

        dynamoDb.putItem(PutItemRequest.builder().tableName(TABLE_NAME).item(item).build());
    }

    private Map<String, AttributeValue> getExistingRecord(String icao24) {
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

    private static AttributeValue str(String s) { return AttributeValue.builder().s(s).build(); }
    private static AttributeValue num(String n) { return AttributeValue.builder().n(n).build(); }
    private static AttributeValue bool(boolean b) { return AttributeValue.builder().bool(b).build(); }
}
