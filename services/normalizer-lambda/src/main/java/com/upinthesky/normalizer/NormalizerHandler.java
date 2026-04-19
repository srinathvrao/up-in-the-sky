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
import software.amazon.awssdk.services.dynamodb.model.BatchWriteItemRequest;
import software.amazon.awssdk.services.dynamodb.model.BatchWriteItemResponse;
import software.amazon.awssdk.services.dynamodb.model.GetItemRequest;
import software.amazon.awssdk.services.dynamodb.model.GetItemResponse;
import software.amazon.awssdk.services.dynamodb.model.PutRequest;
import software.amazon.awssdk.services.dynamodb.model.WriteRequest;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class NormalizerHandler implements RequestHandler<KinesisEvent, String> {

    private static final DynamoDbClient dynamoDb = DynamoDbClient.builder()
            .region(Region.of(System.getenv().getOrDefault("AWS_REGION", "us-east-1")))
            .build();
    private static final ObjectMapper mapper = new ObjectMapper();
    private static final TypeReference<List<Aircraft>> AIRCRAFT_LIST = new TypeReference<>() {};
    private static final String TABLE_NAME = System.getenv("AIRCRAFT_TABLE_NAME");
    private static final long TTL_SECONDS = 24 * 3600L;
    private static final long ROUTE_REFRESH_SECONDS = 3600L;

    private static final ConcurrentHashMap<String, long[]> writeCache = new ConcurrentHashMap<>();
    private static final long MIN_WRITE_INTERVAL_SEC = 30;
    private static final double MIN_POSITION_DELTA_DEG = 0.01;

    private static final ConcurrentHashMap<String, Long> routeAgeCache = new ConcurrentHashMap<>();
    private static final int MAX_ROUTE_LOOKUPS_PER_INVOCATION = 0;

    // Shared thread pool for parallel route lookups — sized to the lookup cap.
    private static final ExecutorService routeExecutor =
            Executors.newFixedThreadPool(MAX_ROUTE_LOOKUPS_PER_INVOCATION);

    private static final int DYNAMO_BATCH_SIZE = 25;

    private final RouteEnricher routeEnricher = new RouteEnricher();

    @Override
    public String handleRequest(KinesisEvent event, Context context) {
        long now = Instant.now().getEpochSecond();
        List<Map<String, AttributeValue>> toWrite = new ArrayList<>();
        int skipped = 0;
        int errors = 0;

        // Phase 1: parse records, apply dedup filter, build item maps without route data.
        for (KinesisEvent.KinesisEventRecord record : event.getRecords()) {
            try {
                byte[] data = record.getKinesis().getData().array();
                String json = new String(data, StandardCharsets.UTF_8).trim();
                List<Aircraft> batch = json.startsWith("[")
                        ? mapper.readValue(json, AIRCRAFT_LIST)
                        : Collections.singletonList(mapper.readValue(json, Aircraft.class));

                for (Aircraft a : batch) {
                    if (a.getHex() == null || a.getHex().isBlank()) continue;
                    if (a.getLat() == null || a.getLon() == null) continue;
                    String icao24 = a.getHex().toLowerCase();
                    if (shouldWrite(icao24, a.getLat(), a.getLon(), now)) {
                        toWrite.add(buildItem(a, icao24, now));
                    } else {
                        skipped++;
                    }
                }
            } catch (Exception e) {
                errors++;
                context.getLogger().log("Parse error: " + e.getMessage() + "\n");
            }
        }

        // Phase 2: fire route lookups in parallel for items that need enrichment.
        int routeLookups = enrichRoutes(toWrite, now, context);

        // Phase 3: batch write to DynamoDB.
        int writeErrors = batchWrite(toWrite, context);
        errors += writeErrors;

        context.getLogger().log(String.format(
                "processed=%d skipped=%d errors=%d routeLookups=%d%n",
                toWrite.size(), skipped, errors, routeLookups));
        return String.format("processed=%d skipped=%d errors=%d", toWrite.size(), skipped, errors);
    }

    private Map<String, AttributeValue> buildItem(Aircraft a, String icao24, long now) {
        Map<String, AttributeValue> item = new HashMap<>();
        item.put("icao24", str(icao24));
        item.put("updatedAt", str(Instant.ofEpochSecond(now).toString()));
        item.put("ttl", num(String.valueOf(now + TTL_SECONDS)));
        String callsign = a.getFlight();
        if (callsign != null && !callsign.isBlank()) item.put("callsign", str(callsign));
        if (a.getLat() != null) item.put("lat", num(String.valueOf(a.getLat())));
        if (a.getLon() != null) item.put("lon", num(String.valueOf(a.getLon())));
        if (a.getAltitudeFeet() != null) item.put("altitude", num(String.valueOf(a.getAltitudeFeet())));
        if (a.getGs() != null) item.put("groundSpeed", num(String.valueOf(a.getGs())));
        if (a.getTrack() != null) item.put("track", num(String.valueOf(a.getTrack())));
        item.put("onGround", bool(a.isOnGround()));
        return item;
    }

    private int enrichRoutes(List<Map<String, AttributeValue>> items, long now, Context context) {
        // Identify items needing a route lookup (capped) and items that can reuse cached route data.
        List<CompletableFuture<Void>> futures = new ArrayList<>();
        int lookupCount = 0;

        for (Map<String, AttributeValue> item : items) {
            String icao24 = item.get("icao24").s();
            AttributeValue callsignAttr = item.get("callsign");
            if (callsignAttr == null) continue;
            String callsign = callsignAttr.s();

            Long cachedRouteTime = routeAgeCache.get(icao24);

            if (cachedRouteTime == null) {
                // Unknown route age — read DynamoDB to check, then decide.
                Map<String, AttributeValue> existing = getExistingRecord(icao24);
                if (existing != null && existing.containsKey("routeUpdatedAt")) {
                    try {
                        long routeTime = Instant.parse(existing.get("routeUpdatedAt").s()).getEpochSecond();
                        routeAgeCache.put(icao24, routeTime);
                        cachedRouteTime = routeTime;
                        copyRouteFields(existing, item);
                    } catch (Exception ignored) {}
                }
            } else {
                // Route age known — copy from a prior DynamoDB read if not stale.
                // (Fields are already in the item if we read DynamoDB above; otherwise omitted intentionally.)
            }

            boolean needsRefresh = cachedRouteTime == null || (now - cachedRouteTime) > ROUTE_REFRESH_SECONDS;
            if (needsRefresh && lookupCount < MAX_ROUTE_LOOKUPS_PER_INVOCATION) {
                lookupCount++;
                CompletableFuture<Void> f = CompletableFuture.runAsync(() -> {
                    try {
                        RouteInfo route = routeEnricher.fetchRoute(callsign);
                        if (route != null && route.getOrigin() != null) {
                            String ts = Instant.now().toString();
                            synchronized (item) {
                                item.put("origin", str(route.getOrigin().getIata()));
                                item.put("destination", str(route.getDestination().getIata()));
                                item.put("routeUpdatedAt", str(ts));
                            }
                            routeAgeCache.put(icao24, now);
                        }
                    } catch (Exception e) {
                        context.getLogger().log("Route lookup failed for " + callsign + ": " + e.getMessage() + "\n");
                    }
                }, routeExecutor);
                futures.add(f);
            }
        }

        if (!futures.isEmpty()) {
            CompletableFuture.allOf(futures.toArray(new CompletableFuture[0])).join();
        }
        return lookupCount;
    }

    private void copyRouteFields(Map<String, AttributeValue> src, Map<String, AttributeValue> dst) {
        if (src.containsKey("origin")) dst.put("origin", src.get("origin"));
        if (src.containsKey("destination")) dst.put("destination", src.get("destination"));
        if (src.containsKey("routeUpdatedAt")) dst.put("routeUpdatedAt", src.get("routeUpdatedAt"));
    }

    private int batchWrite(List<Map<String, AttributeValue>> items, Context context) {
        int errors = 0;
        for (int i = 0; i < items.size(); i += DYNAMO_BATCH_SIZE) {
            List<Map<String, AttributeValue>> chunk = items.subList(i, Math.min(i + DYNAMO_BATCH_SIZE, items.size()));
            List<WriteRequest> requests = new ArrayList<>(chunk.size());
            for (Map<String, AttributeValue> item : chunk) {
                requests.add(WriteRequest.builder().putRequest(PutRequest.builder().item(item).build()).build());
            }
            try {
                BatchWriteItemResponse response = dynamoDb.batchWriteItem(
                        BatchWriteItemRequest.builder().requestItems(Map.of(TABLE_NAME, requests)).build());
                // Retry any unprocessed items once.
                Map<String, List<WriteRequest>> unprocessed = response.unprocessedItems();
                if (!unprocessed.isEmpty()) {
                    dynamoDb.batchWriteItem(
                            BatchWriteItemRequest.builder().requestItems(unprocessed).build());
                }
            } catch (Exception e) {
                errors++;
                context.getLogger().log("BatchWrite error: " + e.getMessage() + "\n");
            }
        }
        return errors;
    }

    private boolean shouldWrite(String icao24, double lat, double lon, long now) {
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
        writeCache.put(icao24, new long[]{epochSec, Double.doubleToLongBits(lat), Double.doubleToLongBits(lon)});
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
