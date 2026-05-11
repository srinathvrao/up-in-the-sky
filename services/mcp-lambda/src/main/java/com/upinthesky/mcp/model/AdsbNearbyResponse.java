package com.upinthesky.mcp.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import java.util.List;

@JsonIgnoreProperties(ignoreUnknown = true)
public class AdsbNearbyResponse {
    private List<AdsbAircraft> ac;

    public List<AdsbAircraft> getAc() { return ac; }
    public void setAc(List<AdsbAircraft> ac) { this.ac = ac; }
}
