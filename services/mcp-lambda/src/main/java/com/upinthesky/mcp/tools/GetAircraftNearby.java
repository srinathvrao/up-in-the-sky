package com.upinthesky.mcp.tools;

import com.amazonaws.services.lambda.runtime.LambdaLogger;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.upinthesky.mcp.model.AdsbAircraft;
import com.upinthesky.mcp.model.AdsbNearbyResponse;
import com.upinthesky.mcp.model.AircraftPosition;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;

public class GetAircraftNearby {

    private static final HttpClient httpClient = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(3))
            .build();
    private static final ObjectMapper mapper = new ObjectMapper();

    private final String adsbBaseUrl;

    public GetAircraftNearby(String adsbBaseUrl) {
        this.adsbBaseUrl = adsbBaseUrl;
    }

    public List<AircraftPosition> execute(Map<String, Object> input, LambdaLogger logger) {
        double lat = toDouble(input.get("lat"));
        double lon = toDouble(input.get("lon"));
        int radiusNm = toInt(input.get("radius_nm"));

        String url = String.format("%s/v2/lat/%.4f/lon/%.4f/dist/%d", adsbBaseUrl, lat, lon, radiusNm);
        try {
            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(url))
                    .timeout(Duration.ofSeconds(3))
                    .header("Accept", "application/json")
                    .GET()
                    .build();

            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() != 200) {
                logger.log("adsb.lol returned HTTP " + response.statusCode() + " for nearby query");
                return Collections.emptyList();
            }

            AdsbNearbyResponse parsed = mapper.readValue(response.body(), AdsbNearbyResponse.class);
            if (parsed.getAc() == null) return Collections.emptyList();

            List<AircraftPosition> results = new ArrayList<>();
            for (AdsbAircraft ac : parsed.getAc()) {
                if (ac.getLat() == null || ac.getLon() == null) continue;
                AircraftPosition pos = new AircraftPosition();
                pos.setIcao24(ac.getHex());
                pos.setCallsign(ac.getFlight());
                pos.setLat(ac.getLat());
                pos.setLon(ac.getLon());
                pos.setAltitude(ac.getAltitudeFeet());
                pos.setGroundSpeed(ac.getGs());
                pos.setTrack(ac.getTrack());
                pos.setOnGround(ac.isOnGround());
                results.add(pos);
            }
            return results;
        } catch (Exception e) {
            logger.log("adsb.lol nearby call failed: " + e.getMessage());
            return Collections.emptyList();
        }
    }

    private static double toDouble(Object v) {
        if (v instanceof Number) return ((Number) v).doubleValue();
        return Double.parseDouble(String.valueOf(v));
    }

    private static int toInt(Object v) {
        if (v instanceof Number) return ((Number) v).intValue();
        return Integer.parseInt(String.valueOf(v));
    }
}
