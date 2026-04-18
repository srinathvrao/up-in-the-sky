package com.upinthesky.poller;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.upinthesky.poller.model.AdsbResponse;
import com.upinthesky.poller.model.Aircraft;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Collections;
import java.util.List;

public class AdsbApiClient {

    private static final String BASE_URL = "https://api.adsb.lol/v2";
    private static final HttpClient httpClient = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(5))
            .build();
    private static final ObjectMapper mapper = new ObjectMapper();

    public List<Aircraft> fetchPositions(double lat, double lon, int radiusNm) throws Exception {
        String url = String.format("%s/lat/%.4f/lon/%.4f/dist/%d", BASE_URL, lat, lon, radiusNm);
        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(url))
                .timeout(Duration.ofSeconds(8))
                .header("Accept", "application/json")
                .GET()
                .build();

        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() != 200) {
            throw new RuntimeException("adsb.lol positions API returned HTTP " + response.statusCode());
        }

        AdsbResponse adsbResponse = mapper.readValue(response.body(), AdsbResponse.class);
        return adsbResponse.getAc() != null ? adsbResponse.getAc() : Collections.emptyList();
    }
}
