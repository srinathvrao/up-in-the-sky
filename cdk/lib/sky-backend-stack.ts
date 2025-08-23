import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import { Construct } from 'constructs';
import * as path from 'path';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';

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

    // adding rate limiting to my API gateway: 30 requests per IP per minute
    const webAcl = new wafv2.CfnWebACL(this, 'WebAcl', {
                    defaultAction: { allow: {} },
                    scope: 'REGIONAL',
                    visibilityConfig: {
                      cloudWatchMetricsEnabled: true,
                      metricName: 'webAcl',
                      sampledRequestsEnabled: true,
                    },
                    rules: [
                      {
                        name: 'RateLimitRule',
                        priority: 1,
                        action: { block: {} },
                        statement: {
                          rateBasedStatement: {
                            limit: 30,               // 30 requests
                            aggregateKeyType: 'IP',  // per IP
                          },
                        },
                        visibilityConfig: {
                          cloudWatchMetricsEnabled: true,
                          metricName: 'rateLimit',
                          sampledRequestsEnabled: true,
                        },
                      },
                    ],
                  });
      
      new wafv2.CfnWebACLAssociation(this, 'WebAclAssociation', {
              resourceArn: `arn:aws:apigateway:${this.region}::/restapis/${api.restApiId}/stages/${api.deploymentStage.stageName}`,
              webAclArn: webAcl.attrArn,
            });


  }
}
