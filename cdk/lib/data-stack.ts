import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as kinesis from 'aws-cdk-lib/aws-kinesis';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as firehose from 'aws-cdk-lib/aws-kinesisfirehose';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as path from 'path';

export class DataStack extends cdk.Stack {
  public readonly stream: kinesis.Stream;
  public readonly aircraftTable: dynamodb.Table;
  public readonly archiveBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Kinesis Data Stream — 1 shard, 24h retention, partition by icao24
    this.stream = new kinesis.Stream(this, 'FlightStream', {
      shardCount: 1,
      retentionPeriod: cdk.Duration.hours(24),
    });

    // DynamoDB Aircraft table — on-demand, TTL for auto-expiry after 24h
    this.aircraftTable = new dynamodb.Table(this, 'AircraftTable', {
      tableName: 'Aircraft',
      partitionKey: { name: 'icao24', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // GSI for callsign lookups (used by MCP get_aircraft_position tool)
    this.aircraftTable.addGlobalSecondaryIndex({
      indexName: 'callsign-index',
      partitionKey: { name: 'callsign', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI for viewport queries — partition by 2-char geohash cell (~5.6° × 11.25°).
    // Replaces full-table scans with a handful of targeted parallel queries.
    this.aircraftTable.addGlobalSecondaryIndex({
      indexName: 'gh2-index',
      partitionKey: { name: 'gh2', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.INCLUDE,
      nonKeyAttributes: ['callsign', 'lat', 'lon', 'altitude', 'groundSpeed', 'track', 'onGround', 'updatedAt', 'ttl'],
    });

    // S3 archive bucket for Firehose
    this.archiveBucket = new s3.Bucket(this, 'PositionsArchive', {
      bucketName: `up-in-the-sky-positions-${this.account}-${this.region}`,
      lifecycleRules: [{ expiration: cdk.Duration.days(90) }],
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // IAM role for Firehose to read Kinesis and write S3
    const firehoseRole = new iam.Role(this, 'FirehoseRole', {
      assumedBy: new iam.ServicePrincipal('firehose.amazonaws.com'),
    });
    this.stream.grantRead(firehoseRole);
    firehoseRole.addToPolicy(new iam.PolicyStatement({
      actions: ['kinesis:DescribeStream'],
      resources: [this.stream.streamArn],
    }));
    this.archiveBucket.grantWrite(firehoseRole);

    const firehoseLogGroup = new logs.LogGroup(this, 'FirehoseLogGroup', {
      logGroupName: '/aws/kinesisfirehose/flight-positions',
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    new logs.LogStream(this, 'FirehoseLogStream', {
      logGroup: firehoseLogGroup,
      logStreamName: 'S3Delivery',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    firehoseRole.addToPolicy(new iam.PolicyStatement({
      actions: ['logs:PutLogEvents'],
      resources: [firehoseLogGroup.logGroupArn],
    }));

    // Firehose: Kinesis → S3, partitioned by time, 5-min or 128MB buffers
    const flightFirehose = new firehose.CfnDeliveryStream(this, 'FlightFirehose', {
      deliveryStreamType: 'KinesisStreamAsSource',
      kinesisStreamSourceConfiguration: {
        kinesisStreamArn: this.stream.streamArn,
        roleArn: firehoseRole.roleArn,
      },
      s3DestinationConfiguration: {
        bucketArn: this.archiveBucket.bucketArn,
        roleArn: firehoseRole.roleArn,
        prefix: 'positions/year=!{timestamp:yyyy}/month=!{timestamp:MM}/day=!{timestamp:dd}/hour=!{timestamp:HH}/',
        errorOutputPrefix: 'errors/!{firehose:error-output-type}/year=!{timestamp:yyyy}/month=!{timestamp:MM}/day=!{timestamp:dd}/',
        bufferingHints: {
          intervalInSeconds: 300,
          sizeInMBs: 128,
        },
        compressionFormat: 'GZIP',
        cloudWatchLoggingOptions: {
          enabled: true,
          logGroupName: firehoseLogGroup.logGroupName,
          logStreamName: 'S3Delivery',
        },
      },
    });
    // Firehose validates IAM at creation time — ensure the role's DefaultPolicy
    // is fully applied before CloudFormation attempts to create the delivery stream.
    const firehoseDefaultPolicy = firehoseRole.node.tryFindChild('DefaultPolicy') as iam.Policy;
    if (firehoseDefaultPolicy) {
      flightFirehose.node.addDependency(firehoseDefaultPolicy);
    }

    // Poller Lambda — runs for 55s per invocation, polls adsb.lol every 2s
    const pollerLambda = new lambda.Function(this, 'PollerLambda', {
      functionName: 'flight-poller',
      runtime: lambda.Runtime.JAVA_21,
      handler: 'com.upinthesky.poller.PollerHandler::handleRequest',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../services/poller-lambda/target/poller-lambda.jar')),
      timeout: cdk.Duration.seconds(60),
      memorySize: 256,
      environment: {
        KINESIS_STREAM_NAME: this.stream.streamName,
        POLL_CENTER_LAT: '39.0',
        POLL_CENTER_LON: '-98.0',
        POLL_RADIUS_NM: '2000',
      },
    });
    this.stream.grantWrite(pollerLambda);

    // EventBridge triggers poller every minute; Lambda loops internally every 2s
    new events.Rule(this, 'PollerSchedule', {
      ruleName: 'flight-poller-schedule',
      schedule: events.Schedule.rate(cdk.Duration.minutes(1)),
      targets: [new targets.LambdaFunction(pollerLambda)],
    });

    // Normalizer Lambda — consumes Kinesis, normalizes, writes DynamoDB
    const normalizerLambda = new lambda.Function(this, 'NormalizerLambda', {
      functionName: 'flight-normalizer',
      runtime: lambda.Runtime.JAVA_21,
      handler: 'com.upinthesky.normalizer.NormalizerHandler::handleRequest',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../services/normalizer-lambda/target/normalizer-lambda.jar')),
      timeout: cdk.Duration.seconds(300),
      memorySize: 512,
      environment: {
        AIRCRAFT_TABLE_NAME: this.aircraftTable.tableName,
      },
    });
    this.aircraftTable.grantReadWriteData(normalizerLambda);

    // Kinesis event source: smaller batch + 10s window keeps invocations well under timeout
    normalizerLambda.addEventSource(new lambdaEventSources.KinesisEventSource(this.stream, {
      startingPosition: lambda.StartingPosition.LATEST,
      batchSize: 50,
      maxBatchingWindow: cdk.Duration.seconds(10),
      bisectBatchOnError: true,
    }));
  }
}
