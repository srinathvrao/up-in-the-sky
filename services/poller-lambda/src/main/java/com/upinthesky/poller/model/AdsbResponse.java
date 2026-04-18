package com.upinthesky.poller.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import java.util.List;

@JsonIgnoreProperties(ignoreUnknown = true)
public class AdsbResponse {

    private List<Aircraft> ac;
    private Integer total;
    private Double now;

    public List<Aircraft> getAc() { return ac; }
    public void setAc(List<Aircraft> ac) { this.ac = ac; }

    public Integer getTotal() { return total; }
    public void setTotal(Integer total) { this.total = total; }

    public Double getNow() { return now; }
    public void setNow(Double now) { this.now = now; }
}
