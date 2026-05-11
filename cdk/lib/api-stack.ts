import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as kinesis from 'aws-cdk-lib/aws-kinesis';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigwv2Integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as path from 'path';

interface ApiStackProps extends cdk.StackProps {
  stream: kinesis.Stream;
}

export class ApiStack extends cdk.Stack {
  public readonly wsApiUrl: string;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    // DynamoDB table to track live WebSocket connection IDs
    const connectionsTable = new dynamodb.Table(this, 'ConnectionsTable', {
      tableName: 'WsConnections',
      partitionKey: { name: 'connectionId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // WebSocket API
    const wsApi = new apigwv2.WebSocketApi(this, 'FlightWsApi', {
      apiName: 'flight-ws-api',
    });

    const wsStage = new apigwv2.WebSocketStage(this, 'FlightWsStage', {
      webSocketApi: wsApi,
      stageName: 'prod',
      autoDeploy: true,
    });

    // $connect — store connection ID
    const connectFn = new lambda.Function(this, 'WsConnectFn', {
      functionName: 'ws-connect',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'index.handler',
      code: lambda.Code.fromInline(
        'import os,boto3,time\n' +
        'ddb=boto3.resource("dynamodb")\n' +
        'table=ddb.Table(os.environ["CONNECTIONS_TABLE"])\n' +
        'def handler(event,context):\n' +
        '    table.put_item(Item={"connectionId":event["requestContext"]["connectionId"],"ttl":int(time.time())+86400})\n' +
        '    return{"statusCode":200}\n'
      ),
      environment: { CONNECTIONS_TABLE: connectionsTable.tableName },
    });
    connectionsTable.grantReadWriteData(connectFn);

    // $disconnect — remove connection ID
    const disconnectFn = new lambda.Function(this, 'WsDisconnectFn', {
      functionName: 'ws-disconnect',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'index.handler',
      code: lambda.Code.fromInline(
        'import os,boto3\n' +
        'ddb=boto3.resource("dynamodb")\n' +
        'table=ddb.Table(os.environ["CONNECTIONS_TABLE"])\n' +
        'def handler(event,context):\n' +
        '    table.delete_item(Key={"connectionId":event["requestContext"]["connectionId"]})\n' +
        '    return{"statusCode":200}\n'
      ),
      environment: { CONNECTIONS_TABLE: connectionsTable.tableName },
    });
    connectionsTable.grantReadWriteData(disconnectFn);

    wsApi.addRoute('$connect', {
      integration: new apigwv2Integrations.WebSocketLambdaIntegration('ConnectInt', connectFn),
    });
    wsApi.addRoute('$disconnect', {
      integration: new apigwv2Integrations.WebSocketLambdaIntegration('DisconnectInt', disconnectFn),
    });

    // Management API endpoint used by broadcaster to post messages to connections
    const wsManagementEndpoint = `https://${wsApi.apiId}.execute-api.${this.region}.amazonaws.com/${wsStage.stageName}`;

    // Broadcaster Lambda — reads from Kinesis and fans out aircraft_update events to all WebSocket clients
    const broadcasterFn = new lambda.Function(this, 'BroadcasterFn', {
      functionName: 'ws-broadcaster',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'main.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../services/broadcaster-lambda')),
      timeout: cdk.Duration.seconds(60),
      memorySize: 256,
      environment: {
        CONNECTIONS_TABLE: connectionsTable.tableName,
        WS_MANAGEMENT_ENDPOINT: wsManagementEndpoint,
      },
    });
    connectionsTable.grantReadWriteData(broadcasterFn);
    props.stream.grantRead(broadcasterFn);

    // Allow broadcaster to post to WebSocket connections
    broadcasterFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['execute-api:ManageConnections'],
      resources: [
        `arn:aws:execute-api:${this.region}:${this.account}:${wsApi.apiId}/${wsStage.stageName}/POST/@connections/*`,
      ],
    }));

    // Parallel Kinesis consumer alongside the normalizer — 2s batching window for low latency
    broadcasterFn.addEventSource(new lambdaEventSources.KinesisEventSource(props.stream, {
      startingPosition: lambda.StartingPosition.LATEST,
      batchSize: 50,
      maxBatchingWindow: cdk.Duration.seconds(2),
      bisectBatchOnError: true,
    }));

    this.wsApiUrl = wsStage.url;

    new cdk.CfnOutput(this, 'WsApiUrl', {
      value: wsStage.url,
      description: 'WebSocket connect URL — wss://... (use as NEXT_PUBLIC_API_WS_URL)',
    });

    new cdk.CfnOutput(this, 'HttpApiUrl', {
      value: `https://oyfi3ca3liovtt3ch2hjyeqsjm0jqexa.lambda-url.us-east-1.on.aws`,
      description: 'Chat service HTTP URL — use as NEXT_PUBLIC_API_HTTP_URL',
    });
  }
}
