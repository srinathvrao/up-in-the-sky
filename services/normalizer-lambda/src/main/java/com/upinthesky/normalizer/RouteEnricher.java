package com.upinthesky.normalizer;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.upinthesky.normalizer.model.RouteInfo;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;

public class RouteEnricher {

    private static final String ROUTE_BASE_URL = "https://api.adsb.lol/api/0/route";
    private static final HttpClient httpClient = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(5))
            .build();
    private static final ObjectMapper mapper = new ObjectMapper();

    /**
     * Fetches origin/destination for a callsign from adsb.lol.
     * Returns null if the callsign is blank, the lookup fails, or the API returns no route.
     */
    public RouteInfo fetchRoute(String callsign) {
        if (callsign == null || callsign.isBlank()) return null;
        try {
            String url = ROUTE_BASE_URL + "/" + callsign.strip();
            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(url))
                    .timeout(Duration.ofSeconds(5))
                    .header("Accept", "application/json")
                    .GET()
                    .build();

            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() == 404) return null;
            if (response.statusCode() != 200) {
                throw new RuntimeException("Route API returned HTTP " + response.statusCode());
            }
            return mapper.readValue(response.body(), RouteInfo.class);
        } catch (Exception e) {
            return null;
        }
    }
}
