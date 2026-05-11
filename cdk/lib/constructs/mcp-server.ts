import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as path from 'path';

interface McpServerProps {
  aircraftTable: dynamodb.Table;
}

export class McpServer extends Construct {
  public readonly lambdaFunction: lambda.Function;

  constructor(scope: Construct, id: string, props: McpServerProps) {
    super(scope, id);

    this.lambdaFunction = new lambda.Function(this, 'McpLambda', {
      functionName: 'flight-mcp-server',
      runtime: lambda.Runtime.JAVA_21,
      handler: 'com.upinthesky.mcp.McpHandler::handleRequest',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../../services/mcp-lambda/target/mcp-lambda.jar')),
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: {
        AIRCRAFT_TABLE_NAME: props.aircraftTable.tableName,
        ADSB_BASE_URL: 'https://api.adsb.lol',
      },
    });

    props.aircraftTable.grantReadData(this.lambdaFunction);
  }
}
