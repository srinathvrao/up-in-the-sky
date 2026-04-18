import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { McpServer } from './constructs/mcp-server';

interface ComputeStackProps extends cdk.StackProps {
  aircraftTable: dynamodb.Table;
}

export class ComputeStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ComputeStackProps) {
    super(scope, id, props);

    new McpServer(this, 'McpServer', {
      aircraftTable: props.aircraftTable,
    });
  }
}
