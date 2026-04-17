import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';

export class ComputeStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
    // Day 2: Poller, Normalizer, MCP, Chat Lambdas
  }
}