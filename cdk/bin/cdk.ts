#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { DataStack } from '../lib/data-stack';
import { ApiStack } from '../lib/api-stack';
import { ComputeStack } from '../lib/compute-stack';

const app = new cdk.App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: 'us-east-1',
};

const dataStack = new DataStack(app, 'data-stack', { env });
const apiStack = new ApiStack(app, 'api-stack', { env });
new ComputeStack(app, 'compute-stack', { env, aircraftTable: dataStack.aircraftTable });