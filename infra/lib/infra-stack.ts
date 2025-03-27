import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';

interface StaticSiteStackProps extends cdk.StackProps {
  domainName: string;      // e.g., example.com
  siteSubDomain?: string;  // e.g., www (optional)
}

export class InfraStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: StaticSiteStackProps) {
    super(scope, id, props);
    
    const domainName = props.domainName;
    const siteSubDomain = props.siteSubDomain || '';
    const siteDomain = siteSubDomain ? `${siteSubDomain}.${domainName}` : domainName;

    // Create an S3 bucket to store the website
    const siteBucket = new s3.Bucket(this, 'SiteBucket', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL
    });

    // Look up the hosted zone
    const zone = route53.HostedZone.fromLookup(this, 'Zone', {
      domainName: domainName
    });
    
    // Create an ACM certificate
    const certificate = new acm.DnsValidatedCertificate(this, 'SiteCertificate', {
      domainName: siteDomain,
      hostedZone: zone,
      region: 'us-east-1', // CloudFront requires certificates in us-east-1
    });
    
    // Create a CloudFront function to append .html to URLs without extensions
    const appendHtmlFunction = new cloudfront.Function(this, 'AppendHtmlFunction', {
      code: cloudfront.FunctionCode.fromInline(`
        function handler(event) {
          var request = event.request;
          var uri = request.uri;
          
          // Don't modify requests that already have file extensions or end with a slash
          if (uri.includes('.') || uri.endsWith('/')) {
            return request;
          }
          
          // Don't modify if it's trying to access a specific file in a folder
          if (uri.split('/').length > 2 && !uri.endsWith('/')) {
            return request;
          }
          
          // Append .html to the URI
          request.uri = uri + '.html';
          
          return request;
        }
      `),
      comment: 'Append .html extension to URLs without extensions'
    });
    
    // Create a CloudFront distribution to serve the website
    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultBehavior: {
        origin: new origins.S3Origin(siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        functionAssociations: [
          {
            function: appendHtmlFunction,
            eventType: cloudfront.FunctionEventType.VIEWER_REQUEST
          }
        ]
      },
      domainNames: [siteDomain],
      certificate: certificate,
      defaultRootObject: 'index.html',
      // Add error handling for SPA routes - this is needed because direct route accesses 
      // will return 403 when the file doesn't exist in S3
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html'
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html'
        }
      ]
    });

    // Deploy the contents of the 'out' folder to the S3 bucket
    new s3deploy.BucketDeployment(this, 'DeployWebsite', {
      sources: [s3deploy.Source.asset('../out')],
      destinationBucket: siteBucket,
      distribution,
      distributionPaths: ['/*']
    });
    
    // Create a Route53 A record that points to the CloudFront distribution
    new route53.ARecord(this, 'SiteAliasRecord', {
      recordName: siteDomain,
      target: route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(distribution)),
      zone
    });
    
    // Output the CloudFront URL and site URL
    new cdk.CfnOutput(this, 'DistributionDomainName', {
      value: distribution.distributionDomainName,
      description: 'The domain name of the CloudFront distribution'
    });
    
    new cdk.CfnOutput(this, 'SiteUrl', {
      value: `https://${siteDomain}`,
      description: 'The URL of the website'
    });
  }
}
