package com.upinthesky.poller;

import com.amazonaws.services.lambda.runtime.Context;
import com.amazonaws.services.lambda.runtime.RequestHandler;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.upinthesky.poller.model.Aircraft;
import software.amazon.awssdk.core.SdkBytes;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.kinesis.KinesisClient;
import software.amazon.awssdk.services.kinesis.model.PutRecordsRequest;
import software.amazon.awssdk.services.kinesis.model.PutRecordsRequestEntry;
import software.amazon.awssdk.services.kinesis.model.PutRecordsResponse;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

public class PollerHandler implements RequestHandler<Map<String, Object>, String> {

    private static final KinesisClient kinesisClient = KinesisClient.builder()
            .region(Region.of(System.getenv().getOrDefault("AWS_REGION", "us-east-1")))
            .build();
    private static final ObjectMapper mapper = new ObjectMapper();

    private static final String STREAM_NAME = System.getenv("KINESIS_STREAM_NAME");
    private static final double LAT = Double.parseDouble(
            System.getenv().getOrDefault("POLL_CENTER_LAT", "39.0"));
    private static final double LON = Double.parseDouble(
            System.getenv().getOrDefault("POLL_CENTER_LON", "-98.0"));
    private static final int RADIUS_NM = Integer.parseInt(
            System.getenv().getOrDefault("POLL_RADIUS_NM", "2000"));

    // EventBridge minimum schedule is 1 minute; loop internally for 2-second cadence
    private static final long LOOP_DURATION_MS = 55_000L;
    private static final int POLL_INTERVAL_MS = 2_000;
    // Pack 200 aircraft per Kinesis record — avoids 5 KB/record minimum billing on small records
    private static final int AIRCRAFT_PER_RECORD = 200;
    private static final int KINESIS_BATCH_LIMIT = 500;

    private final AdsbApiClient apiClient = new AdsbApiClient();

    @Override
    public String handleRequest(Map<String, Object> input, Context context) {
        long startMs = System.currentTimeMillis();
        int iterations = 0;
        int errors = 0;

        while (System.currentTimeMillis() - startMs < LOOP_DURATION_MS) {
            try {
                long pollTimestamp = Instant.now().toEpochMilli();
                List<Aircraft> aircraft = apiClient.fetchPositions(LAT, LON, RADIUS_NM);

                if (!aircraft.isEmpty()) {
                    for (Aircraft a : aircraft) {
                        a.setPolledAt(pollTimestamp);
                    }
                    int pushed = pushToKinesis(aircraft);
                    context.getLogger().log(String.format(
                            "iter=%d aircraft=%d pushed=%d%n",
                            iterations + 1, aircraft.size(), pushed));
                }
                iterations++;
                Thread.sleep(POLL_INTERVAL_MS);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                break;
            } catch (Exception e) {
                errors++;
                context.getLogger().log("Poll error: " + e.getMessage() + "\n");
            }
        }
        return String.format("iterations=%d errors=%d", iterations, errors);
    }

    private int pushToKinesis(List<Aircraft> aircraft) throws Exception {
        // Chunk aircraft into batches of AIRCRAFT_PER_RECORD and write each chunk as one Kinesis record.
        // Each ~46 KB record is billed at actual size rather than the 5 KB minimum per-record.
        List<PutRecordsRequestEntry> entries = new ArrayList<>();
        for (int i = 0; i < aircraft.size(); i += AIRCRAFT_PER_RECORD) {
            List<Aircraft> chunk = aircraft.subList(i, Math.min(i + AIRCRAFT_PER_RECORD, aircraft.size()));
            String json = mapper.writeValueAsString(chunk);
            entries.add(PutRecordsRequestEntry.builder()
                    .data(SdkBytes.fromUtf8String(json))
                    .partitionKey("batch-" + (i / AIRCRAFT_PER_RECORD))
                    .build());
        }

        int pushed = 0;
        for (int i = 0; i < entries.size(); i += KINESIS_BATCH_LIMIT) {
            List<PutRecordsRequestEntry> batch = entries.subList(
                    i, Math.min(i + KINESIS_BATCH_LIMIT, entries.size()));
            PutRecordsResponse response = kinesisClient.putRecords(PutRecordsRequest.builder()
                    .streamName(STREAM_NAME)
                    .records(batch)
                    .build());
            pushed += (batch.size() - response.failedRecordCount()) * AIRCRAFT_PER_RECORD;
        }
        return pushed;
    }
}
