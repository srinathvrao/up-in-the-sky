import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import { Construct } from 'constructs';
import * as path from 'path';

export class SkyBackendStack extends cdk.Stack {
  public readonly apiUrl: cdk.CfnOutput;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const REPO_ROOT = path.join(process.cwd(),"..");
    const BACKEND_ASSETS = path.join(REPO_ROOT, 'sky-backend/app/build/libs/app-all.jar');

    const backendFn = new lambda.Function(this, 'BackendFn', {
      runtime: lambda.Runtime.JAVA_21,
      handler: 'sky.backend.Handler::handleRequest',
      code: lambda.Code.fromAsset(BACKEND_ASSETS), // built jar
    });

    const api = new apigateway.LambdaRestApi(this, 'Api', {
      handler: backendFn,
      proxy: true,
      defaultCorsPreflightOptions: {
          allowOrigins: ['https://d2skvmc5n608k2.cloudfront.net'],
          allowMethods: ['OPTIONS', 'POST', 'GET'],
          allowHeaders: ['Content-Type'],
        },
    });

    this.apiUrl = new cdk.CfnOutput(this, 'ApiUrl', {
      value: api.url,
    });
  }
}
