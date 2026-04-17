package com.upinthesky.normalizer.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

@JsonIgnoreProperties(ignoreUnknown = true)
public class RouteInfo {

    private String callsign;

    @JsonProperty("_airport_codes_iata")
    private String airportCodesIata;

    private AirportRef origin;
    private AirportRef destination;

    public String getCallsign() { return callsign; }
    public void setCallsign(String callsign) { this.callsign = callsign; }

    public String getAirportCodesIata() { return airportCodesIata; }
    public void setAirportCodesIata(String airportCodesIata) {
        this.airportCodesIata = airportCodesIata;
    }

    public AirportRef getOrigin() { return origin; }
    public void setOrigin(AirportRef origin) { this.origin = origin; }

    public AirportRef getDestination() { return destination; }
    public void setDestination(AirportRef destination) { this.destination = destination; }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class AirportRef {
        private String iata;
        private String name;

        public String getIata() { return iata; }
        public void setIata(String iata) { this.iata = iata; }

        public String getName() { return name; }
        public void setName(String name) { this.name = name; }
    }
}
