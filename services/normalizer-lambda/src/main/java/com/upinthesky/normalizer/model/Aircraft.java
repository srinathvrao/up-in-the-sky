package com.upinthesky.normalizer.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

@JsonIgnoreProperties(ignoreUnknown = true)
public class Aircraft {

    private String hex;
    private String flight;
    private Double lat;
    private Double lon;

    @JsonProperty("alt_baro")
    private Object altBaro;

    private Double gs;
    private Double track;
    private String squawk;
    private String type;
    private Long polledAt;

    public String getHex() { return hex; }
    public void setHex(String hex) { this.hex = hex; }

    public String getFlight() { return flight != null ? flight.trim() : null; }
    public void setFlight(String flight) { this.flight = flight; }

    public Double getLat() { return lat; }
    public void setLat(Double lat) { this.lat = lat; }

    public Double getLon() { return lon; }
    public void setLon(Double lon) { this.lon = lon; }

    public Object getAltBaro() { return altBaro; }
    public void setAltBaro(Object altBaro) { this.altBaro = altBaro; }

    public Double getGs() { return gs; }
    public void setGs(Double gs) { this.gs = gs; }

    public Double getTrack() { return track; }
    public void setTrack(Double track) { this.track = track; }

    public String getSquawk() { return squawk; }
    public void setSquawk(String squawk) { this.squawk = squawk; }

    public String getType() { return type; }
    public void setType(String type) { this.type = type; }

    public Long getPolledAt() { return polledAt; }
    public void setPolledAt(Long polledAt) { this.polledAt = polledAt; }

    public boolean isOnGround() {
        return "ground".equals(altBaro);
    }

    public Integer getAltitudeFeet() {
        if (altBaro instanceof Number) {
            return ((Number) altBaro).intValue();
        }
        return null;
    }
}
