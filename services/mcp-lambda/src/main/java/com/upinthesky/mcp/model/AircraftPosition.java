package com.upinthesky.mcp.model;

import com.fasterxml.jackson.annotation.JsonInclude;

@JsonInclude(JsonInclude.Include.NON_NULL)
public class AircraftPosition {
    private String icao24;
    private String callsign;
    private Double lat;
    private Double lon;
    private Integer altitude;
    private Double groundSpeed;
    private Double track;
    private Boolean onGround;
    private String origin;
    private String destination;
    private String updatedAt;

    public String getIcao24() { return icao24; }
    public void setIcao24(String icao24) { this.icao24 = icao24; }

    public String getCallsign() { return callsign; }
    public void setCallsign(String callsign) { this.callsign = callsign; }

    public Double getLat() { return lat; }
    public void setLat(Double lat) { this.lat = lat; }

    public Double getLon() { return lon; }
    public void setLon(Double lon) { this.lon = lon; }

    public Integer getAltitude() { return altitude; }
    public void setAltitude(Integer altitude) { this.altitude = altitude; }

    public Double getGroundSpeed() { return groundSpeed; }
    public void setGroundSpeed(Double groundSpeed) { this.groundSpeed = groundSpeed; }

    public Double getTrack() { return track; }
    public void setTrack(Double track) { this.track = track; }

    public Boolean getOnGround() { return onGround; }
    public void setOnGround(Boolean onGround) { this.onGround = onGround; }

    public String getOrigin() { return origin; }
    public void setOrigin(String origin) { this.origin = origin; }

    public String getDestination() { return destination; }
    public void setDestination(String destination) { this.destination = destination; }

    public String getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(String updatedAt) { this.updatedAt = updatedAt; }
}
