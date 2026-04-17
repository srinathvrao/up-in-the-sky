import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';

export class DataStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
    // Day 1-2: Kinesis, DynamoDB, S3, Firehose
  }
}