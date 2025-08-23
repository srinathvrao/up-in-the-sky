package sky.backend;

import java.util.Map;

import com.amazonaws.services.lambda.runtime.Context;
import com.amazonaws.services.lambda.runtime.RequestHandler;
import com.amazonaws.services.lambda.runtime.events.APIGatewayProxyRequestEvent;
import com.amazonaws.services.lambda.runtime.events.APIGatewayProxyResponseEvent;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;

public class Handler implements RequestHandler<APIGatewayProxyRequestEvent, APIGatewayProxyResponseEvent> {

    private static final ObjectMapper mapper = new ObjectMapper();

    @Override
    public APIGatewayProxyResponseEvent handleRequest(APIGatewayProxyRequestEvent request, Context context) {
        try {
            if(request.getBody() != null){
                String body = request.getBody();
                Map<String, Object> map = mapper.readValue(body, new TypeReference<Map<String, Object>>() {});
                String name = map.getOrDefault("name","World").toString();

                context.getLogger().log("Received name: "+name);

                String message = "Processed: " + name;

                return new APIGatewayProxyResponseEvent()
                        .withStatusCode(200)
                        .withHeaders(Map.of(
                                "Content-Type", "application/json",
                                "Access-Control-Allow-Origin", "https://d2skvmc5n608k2.cloudfront.net",
                                "Access-Control-Allow-Methods", "OPTIONS,POST,GET",
                                "Access-Control-Allow-Headers", "Content-Type"
                        ))
                        .withBody("{\"message\":\"" + message + "\"}");
            }
        } catch (Exception e) {
            context.getLogger().log("Error parsing JSON: "+e.getMessage());
            return new APIGatewayProxyResponseEvent()
                    .withStatusCode(500)
                    .withBody("{\"error\":\"FAILED HELLO???\"}");
        }

        return new APIGatewayProxyResponseEvent()
                        .withStatusCode(200)
                        .withHeaders(Map.of(
                                "Content-Type", "application/json",
                                "Access-Control-Allow-Origin", "https://d2skvmc5n608k2.cloudfront.net",
                                "Access-Control-Allow-Methods", "OPTIONS,POST,GET",
                                "Access-Control-Allow-Headers", "Content-Type"
                        ))
                        .withBody("{\"message\":\"Empty Body, OPTIONS method?\"}");
    }
}
