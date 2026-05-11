import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as path from 'path';
import { execSync } from 'child_process';

interface ChatServiceProps {
  mcpLambdaArn: string;
  aircraftTable: dynamodb.Table;
}

export class ChatService extends Construct {
  public readonly lambdaFunction: lambda.Function;
  public readonly functionUrl: lambda.FunctionUrl;

  constructor(scope: Construct, id: string, props: ChatServiceProps) {
    super(scope, id);

    const apiKeyParamName = '/flighttracker/anthropic-api-key';

    // Lambda Web Adapter layer — enables true SSE streaming from FastAPI
    const lwaLayer = lambda.LayerVersion.fromLayerVersionArn(
      this,
      'LwaLayer',
      'arn:aws:lambda:us-east-1:753240598075:layer:LambdaAdapterLayerX86:24',
    );

    const serviceDir = path.join(__dirname, '../../../services/chat-lambda');

    this.lambdaFunction = new lambda.Function(this, 'ChatLambda', {
      functionName: 'flight-chat',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'run.sh',
      code: lambda.Code.fromAsset(serviceDir, {
        bundling: {
          local: {
            tryBundle(outputDir: string) {
              try {
                execSync(
                  `pip3 install -r requirements.txt -t ${outputDir} --quiet`,
                  { cwd: serviceDir, stdio: 'inherit' },
                );
                execSync(`cp -r ${serviceDir}/. ${outputDir}`, { stdio: 'inherit' });
                execSync(`chmod +x ${path.join(outputDir, 'run.sh')}`, { stdio: 'inherit' });
                return true;
              } catch {
                return false;
              }
            },
          },
          image: lambda.Runtime.PYTHON_3_12.bundlingImage,
          command: [
            'bash', '-c',
            'pip install -r requirements.txt -t /asset-output && cp -au . /asset-output && chmod +x /asset-output/run.sh',
          ],
        },
      }),
      layers: [lwaLayer],
      timeout: cdk.Duration.seconds(29),
      memorySize: 512,
      environment: {
        MODEL_ID: 'claude-sonnet-4-20250514',
        MCP_LAMBDA_ARN: props.mcpLambdaArn,
        ANTHROPIC_API_KEY_PARAM: apiKeyParamName,
        AIRCRAFT_TABLE_NAME: props.aircraftTable.tableName,
        AWS_LAMBDA_EXEC_WRAPPER: '/opt/bootstrap',
        AWS_LWA_INVOKE_MODE: 'response_stream',
        PORT: '8080',
      },
    });

    this.lambdaFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['lambda:InvokeFunction'],
      resources: [props.mcpLambdaArn],
    }));

    this.lambdaFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ssm:GetParameter'],
      resources: [`arn:aws:ssm:us-east-1:*:parameter${apiKeyParamName}`],
    }));

    props.aircraftTable.grantReadData(this.lambdaFunction);

    this.functionUrl = this.lambdaFunction.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
      invokeMode: lambda.InvokeMode.RESPONSE_STREAM,
      cors: {
        allowedOrigins: ['*'],
        allowedMethods: [lambda.HttpMethod.ALL],
        allowedHeaders: ['*'],
      },
    });

    new cdk.CfnOutput(this, 'ChatFunctionUrl', {
      value: this.functionUrl.url,
      description: 'Chat endpoint — POST {message, history} to /chat',
    });
  }
}
